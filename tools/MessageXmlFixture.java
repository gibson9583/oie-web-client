/* Regenerate e2e/fixtures/message-control-characters.xml with the engine's
   ObjectXMLSerializer, using only synthetic data. No running engine/database. */
import java.nio.file.*;
import java.util.*;
import com.mirth.connect.model.converters.ObjectXMLSerializer;
import com.mirth.connect.donkey.model.message.*;

public class MessageXmlFixture {
    public static void main(String[] args) throws Exception {
        Calendar date = Calendar.getInstance(TimeZone.getTimeZone("UTC"));
        date.setTimeInMillis(1700000000000L);
        Message message = new Message();
        message.setMessageId(12345L);
        message.setChannelId("c-started");
        message.setServerId("synthetic-server");
        message.setReceivedDate(date);
        message.setProcessed(true);
        ConnectorMessage source = new ConnectorMessage("c-started", "Synthetic channel", 12345L, 0, "synthetic-server", date, Status.RECEIVED);
        source.setConnectorName("Source");
        String raw = "  SYNTHETIC-NCPDP\u001cFIELD\u001dGROUP\u001eSEGMENT\tLINE\nCR\r<>&\"' café 😀 \uE0000; &#x1c;  ";
        source.setRaw(new MessageContent("c-started", 12345L, 0, ContentType.RAW, raw, "NCPDP", false));
        source.setEncoded(new MessageContent("c-started", 12345L, 0, ContentType.ENCODED, "000123", "TEXT", false));
        source.setTransformed(new MessageContent("c-started", 12345L, 0, ContentType.TRANSFORMED, "false", "TEXT", false));
        source.setProcessedRaw(new MessageContent("c-started", 12345L, 0, ContentType.PROCESSED_RAW, "null", "TEXT", false));
        Map<String,Object> map = new LinkedHashMap<>();
        map.put("numeric", "000123"); map.put("boolean", "false");
        map.put("typedBoolean", false); map.put("typedInteger", 17);
        map.put("controls", raw);
        map.put("nested", new LinkedHashMap<>(Map.of("one", new ArrayList<>(List.of("0001", "false")))));
        source.setSourceMap(map);
        message.getConnectorMessages().put(0, source);
        String xml = ObjectXMLSerializer.getInstance().serialize(message);
        Message decoded = ObjectXMLSerializer.getInstance().deserialize(xml, Message.class);
        if (!raw.equals(decoded.getConnectorMessages().get(0).getRaw().getContent())) throw new AssertionError("engine XML roundtrip changed content");
        Files.writeString(Path.of(args[0]), xml + "\n");
        System.out.println("Engine Message/ConnectorMessage/MessageContent XML fixture generated; exact raw roundtrip passed.");
    }
}
