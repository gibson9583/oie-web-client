/*
 * OIE Web Administrator — serializer sidecar.
 *
 * A long-lived process that runs the engine's OWN datatype serializers so the
 * web administrator's message trees are built from byte-identical output to the
 * runtime `msg`/`tmp` (strict and non-strict, every datatype). It bundles no
 * libraries of its own — it is launched with the engine install's jars on the
 * classpath (client-lib, server-lib, extensions/datatype-*-shared) and invokes
 * each datatype's DataTypeDelegate.getSerializer(...).toXML()/toJSON().
 *
 * Protocol (line-oriented, UTF-8; payloads base64 so messages may contain any
 * bytes/newlines):
 *   in :  <id> TAB <dataType> TAB <base64 message> TAB <base64 overrides>
 *   out:  RES TAB <id> TAB OK  TAB <format> TAB <base64 result> TAB <base64 meta>
 *         RES TAB <id> TAB ERR TAB <base64 error>
 * `overrides` is newline-separated key=value pairs applied to the data type's
 * SerializationProperties (e.g. useStrictParser=true). `meta` is a JSON object
 * { "root": "<message type label>", "descriptions": { "<nodeName>": "<text>" } }
 * built from the engine's MessageVocabulary so the web admin's message tree can
 * render the same friendly node descriptions as the Swing client (it is "{}"
 * for JSON results and types without a vocabulary). A single "READY" line is
 * printed once the JVM is up.
 */

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.io.StringReader;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

public class Serializer {

    // dataType (as the web admin sends it) -> { DataTypeProperties FQCN, DataTypeDelegate FQCN }
    private static final Map<String, String[]> TYPES = new HashMap<>();
    static {
        String p = "com.mirth.connect.plugins.datatypes.";
        TYPES.put("HL7V2",     new String[] { p + "hl7v2.HL7v2DataTypeProperties",        p + "hl7v2.HL7v2DataTypeDelegate" });
        TYPES.put("HL7V3",     new String[] { p + "hl7v3.HL7V3DataTypeProperties",        p + "hl7v3.HL7V3DataTypeDelegate" });
        TYPES.put("XML",       new String[] { p + "xml.XMLDataTypeProperties",            p + "xml.XMLDataTypeDelegate" });
        TYPES.put("JSON",      new String[] { p + "json.JSONDataTypeProperties",          p + "json.JSONDataTypeDelegate" });
        TYPES.put("EDI/X12",   new String[] { p + "edi.EDIDataTypeProperties",            p + "edi.EDIDataTypeDelegate" });
        TYPES.put("EDI",       new String[] { p + "edi.EDIDataTypeProperties",            p + "edi.EDIDataTypeDelegate" });
        TYPES.put("X12",       new String[] { p + "edi.EDIDataTypeProperties",            p + "edi.EDIDataTypeDelegate" });
        TYPES.put("NCPDP",     new String[] { p + "ncpdp.NCPDPDataTypeProperties",        p + "ncpdp.NCPDPDataTypeDelegate" });
        TYPES.put("DELIMITED", new String[] { p + "delimited.DelimitedDataTypeProperties", p + "delimited.DelimitedDataTypeDelegate" });
        TYPES.put("RAW",       new String[] { p + "raw.RawDataTypeProperties",            p + "raw.RawDataTypeDelegate" });
        TYPES.put("DICOM",     new String[] { p + "dicom.DICOMDataTypeProperties",        p + "dicom.DICOMDataTypeDelegate" });
    }

    // dataType -> MessageVocabulary FQCN (constructor: (String version, String type)).
    // Types not listed have no friendly descriptions (DefaultVocabulary returns "").
    private static final Map<String, String> VOCAB = new HashMap<>();
    static {
        String p = "com.mirth.connect.plugins.datatypes.";
        VOCAB.put("HL7V2",   p + "hl7v2.HL7v2Vocabulary");
        VOCAB.put("EDI/X12", p + "edi.X12Vocabulary");
        VOCAB.put("X12",     p + "edi.X12Vocabulary");
        VOCAB.put("EDI",     p + "edi.X12Vocabulary");
        VOCAB.put("NCPDP",   p + "ncpdp.NCPDPVocabulary");
        VOCAB.put("DICOM",   p + "dicom.DICOMVocabulary");
    }

    public static void main(String[] args) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        PrintStream out = new PrintStream(System.out, true, "UTF-8");
        out.println("READY");
        String line;
        while ((line = in.readLine()) != null) {
            if (line.isEmpty()) continue;
            String[] parts = line.split("\t", -1);
            String id = parts.length > 0 ? parts[0] : "?";
            try {
                String dataType = parts[1];
                String message = new String(Base64.getDecoder().decode(parts[2]), StandardCharsets.UTF_8);
                String overrides = parts.length > 3 && !parts[3].isEmpty()
                        ? new String(Base64.getDecoder().decode(parts[3]), StandardCharsets.UTF_8) : "";
                String[] result = serialize(dataType, overrides, message);  // [format, text, metaJson]
                out.println("RES\t" + id + "\tOK\t" + result[0] + "\t" + b64(result[1]) + "\t" + b64(result[2]));
            } catch (Throwable t) {
                String msg = t.getClass().getSimpleName() + (t.getMessage() != null ? ": " + t.getMessage() : "");
                out.println("RES\t" + id + "\tERR\t" + b64(msg));
            }
        }
    }

    private static String[] serialize(String dataType, String overrides, String message) throws Exception {
        // Script validation: run the engine's own Rhino compiler check
        // (JavaScriptSharedUtil.validateScript) — null = valid, else an error
        // string ("Error on line N: ..."). Returned as the "text" field.
        if ("__validate__".equals(dataType)) {
            Object err = Class.forName("com.mirth.connect.util.JavaScriptSharedUtil")
                    .getMethod("validateScript", String.class).invoke(null, message);
            return new String[] { "validate", err == null ? "" : err.toString(), "{}" };
        }

        // Pretty-print JS through the engine's own Rhino-AST formatter
        // (JavaScriptSharedUtil.prettyPrint) — the same one Swing's Format Code
        // uses, so E4X XML literals survive. Formatted code returned as "text".
        if ("__prettyprint__".equals(dataType)) {
            Object out = Class.forName("com.mirth.connect.util.JavaScriptSharedUtil")
                    .getMethod("prettyPrint", String.class).invoke(null, message);
            return new String[] { "prettyprint", out == null ? message : out.toString(), "{}" };
        }

        String[] fqcn = TYPES.get(dataType);
        if (fqcn == null) throw new IllegalArgumentException("Unsupported data type: " + dataType);

        Object props = Class.forName(fqcn[0]).getDeclaredConstructor().newInstance();
        // Mutating the SerializationProperties instance held by the props object
        // before building SerializerProperties (which wraps that same instance).
        Object serProps = invoke(props, "getSerializationProperties");
        if (serProps != null && !overrides.isEmpty()) applyOverrides(serProps, overrides);
        Object serializerProperties = invoke(props, "getSerializerProperties");

        Object delegate = Class.forName(fqcn[1]).getDeclaredConstructor().newInstance();
        Class<?> spClass = Class.forName("com.mirth.connect.model.datatype.SerializerProperties");
        Object serializer = delegate.getClass().getMethod("getSerializer", spClass).invoke(delegate, serializerProperties);

        Object stype = invoke(delegate, "getDefaultSerializationType");
        boolean json = stype != null && "JSON".equals(stype.toString());
        String method = json ? "toJSON" : "toXML";
        String result = (String) serializer.getClass().getMethod(method, String.class).invoke(serializer, message);
        result = result == null ? "" : result;
        // The Swing tree decorates only the XML-serialized types with vocabulary
        // descriptions; JSON is rendered as a plain object tree.
        String metaJson = json ? "{}" : buildMeta(serializer, dataType, message, result);
        return new String[] { json ? "json" : "xml", result, metaJson };
    }

    /* Build the message-tree metadata: the root label (message type/version plus
       its description) and a nodeName -> description map, using the engine's own
       MessageVocabulary for this data type. Best-effort: any failure yields "{}"
       so the client simply falls back to bare node names. */
    private static String buildMeta(Object serializer, String dataType, String message, String xml) {
        try {
            String type = "";
            String version = "";
            try {
                Object md = serializer.getClass().getMethod("getMetaDataFromMessage", String.class)
                        .invoke(serializer, message);
                if (md instanceof Map) {
                    Object t = ((Map<?, ?>) md).get("mirth_type");
                    Object v = ((Map<?, ?>) md).get("mirth_version");
                    if (t != null) type = t.toString().trim();
                    if (v != null) version = v.toString().trim();
                }
            } catch (Throwable ignore) { /* no metadata for this type */ }

            Object vocab = makeVocab(dataType, version, type);

            String root = "";
            if (!type.isEmpty()) {
                root = type + " (" + (version.isEmpty() ? "Unknown version" : version) + ")";
                String desc = (vocab != null) ? safeDesc(vocab, type.replaceAll("-", "")) : "";
                if (!desc.isEmpty()) root += " (" + desc + ")";
            }

            StringBuilder descriptions = new StringBuilder("{");
            if (vocab != null && xml != null && !xml.isEmpty()) {
                Map<String, String> map = new LinkedHashMap<>();
                collectDescriptions(xml, vocab, map);
                boolean first = true;
                for (Map.Entry<String, String> e : map.entrySet()) {
                    if (!first) descriptions.append(",");
                    descriptions.append(jsonStr(e.getKey())).append(":").append(jsonStr(e.getValue()));
                    first = false;
                }
            }
            descriptions.append("}");

            return "{" + jsonStr("root") + ":" + jsonStr(root) + ","
                    + jsonStr("descriptions") + ":" + descriptions + "}";
        } catch (Throwable t) {
            return "{}";
        }
    }

    private static Object makeVocab(String dataType, String version, String type) {
        String fqcn = VOCAB.get(dataType);
        if (fqcn == null) return null;
        try {
            return Class.forName(fqcn).getConstructor(String.class, String.class)
                    .newInstance(version == null ? "" : version, type == null ? "" : type);
        } catch (Throwable t) {
            return null;
        }
    }

    private static String safeDesc(Object vocab, String elementId) {
        try {
            Object r = vocab.getClass().getMethod("getDescription", String.class).invoke(vocab, elementId);
            return r == null ? "" : r.toString();
        } catch (Throwable t) {
            return "";
        }
    }

    private static void collectDescriptions(String xml, Object vocab, Map<String, String> map) throws Exception {
        DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
        f.setNamespaceAware(false);
        Document doc = f.newDocumentBuilder().parse(new InputSource(new StringReader(xml)));
        walk(doc.getDocumentElement(), vocab, map, new HashSet<String>());
    }

    private static void walk(Element el, Object vocab, Map<String, String> map, Set<String> seen) {
        if (el == null) return;
        String name = el.getTagName();
        if (seen.add(name)) {
            String d = safeDesc(vocab, name);
            if (!d.isEmpty()) map.put(name, d);
        }
        NodeList kids = el.getChildNodes();
        for (int i = 0; i < kids.getLength(); i++) {
            Node k = kids.item(i);
            if (k instanceof Element) walk((Element) k, vocab, map, seen);
        }
    }

    private static String jsonStr(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    private static void applyOverrides(Object target, String overrides) {
        for (String pair : overrides.split("\n")) {
            int eq = pair.indexOf('=');
            if (eq <= 0) continue;
            String key = pair.substring(0, eq).trim();
            String val = pair.substring(eq + 1);
            Field f = findField(target.getClass(), key);
            if (f == null) continue;
            try {
                f.setAccessible(true);
                Class<?> t = f.getType();
                if (t == boolean.class || t == Boolean.class) f.set(target, Boolean.parseBoolean(val));
                else if (t == int.class || t == Integer.class) f.set(target, Integer.parseInt(val));
                else if (t == String.class) f.set(target, val);
                // other types (nested objects) are left at their defaults
            } catch (Exception ignore) { /* skip fields we can't coerce */ }
        }
    }

    private static Field findField(Class<?> c, String name) {
        for (Class<?> k = c; k != null && k != Object.class; k = k.getSuperclass()) {
            try { return k.getDeclaredField(name); } catch (NoSuchFieldException e) { /* walk up */ }
        }
        return null;
    }

    private static Object invoke(Object o, String method) throws Exception {
        Method m = o.getClass().getMethod(method);
        return m.invoke(o);
    }

    private static String b64(String s) {
        return Base64.getEncoder().encodeToString(s.getBytes(StandardCharsets.UTF_8));
    }
}
