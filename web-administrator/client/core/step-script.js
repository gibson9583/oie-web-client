/*
 * Client-side "Generated Script" for filter rules and transformer steps.
 *
 * Faithful re-implementation of each element's getScript(false) in the OIE
 * engine's Java source (server/src/com/mirth/connect/plugins/<name>/Step or Rule
 * and model/Iterator*.java) so the web admin's Generated Script tab shows the
 * same JavaScript the engine compiles — for the non-JavaScript step/rule types
 * that don't carry a client-side script. Source of truth: the Java getScript()
 * methods; whitespace/quoting is reproduced exactly. loadFiles is always false
 * here (design-time preview), so External Script emits the "// Path:" comment.
 *
 * Dispatch is by element.__type (the Java class name the model carries).
 */

/* Scope enum -> map object (MapperStep.Scope.map). */
const SCOPE_MAP = {
    CONNECTOR: 'connectorMap',
    CHANNEL: 'channelMap',
    GLOBAL_CHANNEL: 'globalChannelMap',
    GLOBAL: 'globalMap',
    RESPONSE: 'responseMap'
};

/* JavaScriptSharedUtil.convertIdentifier — for iterator temp-var names. */
function convertIdentifier(id) {
    return String(id ?? '').replace(/[^a-zA-Z0-9_$]/g, '') || '_';
}

/* Pair list from the model's `replacements`, normalized to [ [left, right], … ].
   The strings are already quoted JS expressions in the model — inserted raw. */
function replacementPairs(el) {
    let r = el && el.replacements;
    if (!r) return [];
    if (r.entry) r = r.entry;                 // XStream map/list wrapper
    const arr = Array.isArray(r) ? r : [r];
    return arr.map((p) => {
        if (Array.isArray(p)) return [p[0], p[1]];
        if (p == null || typeof p !== 'object') return null;
        // Pair serialized as {left,right} | {key,value} | {first,second} | {string:[a,b]}
        if (p.left !== undefined) return [p.left, p.right];
        if (p.key !== undefined) return [p.key, p.value];
        if (p.first !== undefined) return [p.first, p.second];
        if (Array.isArray(p.string)) return [p.string[0], p.string[1]];
        return null;
    }).filter(Boolean);
}

/* MapperStep.buildRegexArray — new Array(new Array(l,r),…) or new Array(). */
function buildRegexArray(el) {
    const pairs = replacementPairs(el);
    if (!pairs.length) return 'new Array()';
    return 'new Array(' + pairs.map(([l, r]) => `new Array(${l}, ${r})`).join(',') + ')';
}

/* Shared condition clause for RuleBuilderRule / DestinationSetFilterStep. They
   are identical except EXISTS/NOT_EXIST (`.length` vs getArrayOrXmlLength) — the
   Java emits the same operator/join logic otherwise. `field`/`values` are raw. */
function conditionClause(field, condition, values, existsStyle) {
    const vals = Array.isArray(values) ? values : (values && values.string ? (Array.isArray(values.string) ? values.string : [values.string]) : []);
    const exists = existsStyle === 'xml'
        ? { yes: `getArrayOrXmlLength(${field}) > 0) `, no: `getArrayOrXmlLength(${field}) == 0) ` }
        : { yes: `${field}.length > 0) `, no: `${field}.length == 0) ` };

    if (condition === 'EXISTS') return exists.yes;
    if (condition === 'NOT_EXIST') return exists.no;

    if (condition === 'CONTAINS' || condition === 'NOT_CONTAIN') {
        const eq = condition === 'CONTAINS' ? '!=' : '==';
        const join = condition === 'CONTAINS' ? '||' : '&&';
        if (!vals.length) return `${field}.indexOf("") ${eq} -1) `;
        return vals.map((v) => `(${field}.indexOf(${v}) ${eq} -1)`).join(` ${join} `) + ') ';
    }
    // EQUALS / NOT_EQUAL (and any default)
    const eq = condition === 'EQUALS' ? '==' : '!=';
    const join = condition === 'EQUALS' ? '||' : '&&';
    if (!vals.length) return `${field} ${eq} "") `;
    return vals.map((v) => `${field} ${eq} ${v}`).join(` ${join} `) + ') ';
}

/* ---- per-type generators (getScript(false)) ---- */

function mapperScript(el) {
    const scopeMap = SCOPE_MAP[el.scope] || SCOPE_MAP.CHANNEL;
    const mapping = (el.mapping && String(el.mapping).trim()) ? el.mapping : "''";  // defaultIfBlank
    const def = (el.defaultValue && String(el.defaultValue).length) ? el.defaultValue : "''";
    return `var mapping;\n\ntry {\n\tmapping = ${mapping}; \n} catch (e) {\n\tmapping = '';\n}\n\n`
        + `${scopeMap}.put('${el.variable ?? ''}', validate( mapping , ${def}, ${buildRegexArray(el)}));`;
}

function messageBuilderScript(el) {
    const mapping = (el.mapping && String(el.mapping).length) ? el.mapping : "''";
    const def = (el.defaultValue && String(el.defaultValue).length) ? el.defaultValue : "''";
    return `${el.messageSegment ?? ''} = validate(${mapping}, ${def}, ${buildRegexArray(el)});`;
}

function xsltScript(el) {
    const factory = (el.useCustomFactory && el.customFactory)
        ? `Packages.javax.xml.transform.TransformerFactory.newInstance("${el.customFactory}", null)`
        : 'Packages.javax.xml.transform.TransformerFactory.newInstance()';
    return `tFactory = ${factory};\n`
        + `xsltTemplate = new Packages.java.io.StringReader(${el.template ?? ''});\n`
        + `transformer = tFactory.newTransformer(new Packages.javax.xml.transform.stream.StreamSource(xsltTemplate));\n`
        + `sourceVar = new Packages.java.io.StringReader(${el.sourceXml ?? ''});\n`
        + `resultVar = new Packages.java.io.StringWriter();\n`
        + `transformer.transform(new Packages.javax.xml.transform.stream.StreamSource(sourceVar), new Packages.javax.xml.transform.stream.StreamResult(resultVar));\n`
        + `channelMap.put('${el.resultVariable ?? ''}', resultVar.toString());\n`;
}

function externalScript(el) {
    // loadFiles = false (design-time preview)
    return `// External script will be loaded on deploy\n// Path: ${el.scriptPath ?? ''}\n`;
}

function destinationSetFilterScript(el) {
    const clause = conditionClause(el.field, el.condition, el.values, 'xml');
    const ids = Array.isArray(el.metaDataIds) ? el.metaDataIds.join(', ')
        : (el.metaDataIds && el.metaDataIds.int ? [].concat(el.metaDataIds.int).join(', ') : '');
    let call;
    if (el.behavior === 'REMOVE') call = `remove([${ids}])`;
    else if (el.behavior === 'REMOVE_ALL_EXCEPT') call = `removeAllExcept([${ids}])`;
    else call = 'removeAll()';
    return `if (${clause}{\n\tdestinationSet.${call};\n}\n`;
}

function ruleBuilderScript(el) {
    const clause = conditionClause(el.field, el.condition, el.values, 'length');
    return `if(${clause}{\n\treturn true;\n}\nreturn false;`;
}

/* ---- dispatcher ---- */

const GENERATORS = {
    'com.mirth.connect.plugins.mapper.MapperStep': mapperScript,
    'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep': messageBuilderScript,
    'com.mirth.connect.plugins.xsltstep.XsltStep': xsltScript,
    'com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep': externalScript,
    'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep': destinationSetFilterScript,
    'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule': ruleBuilderScript,
    'com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule': externalScript,
    // JavaScript step/rule carry their own .script — handled by the caller.
    // Iterator step/rule are recursive over children — handled below.
};

const ITERATOR_TYPES = new Set([
    'com.mirth.connect.model.IteratorStep',
    'com.mirth.connect.model.IteratorRule'
]);

/*
 * Build the generated JavaScript for one element. Returns a string, or null if
 * the type has no client-side generator (the caller falls back to element.script
 * for JavaScript steps/rules, else a notice).
 *   getChildren(el) -> array of child elements (for Iterator recursion).
 */
export function generateElementScript(element, getChildren) {
    if (!element) return null;
    const type = element.__type;

    if (ITERATOR_TYPES.has(type)) return iteratorScript(element, getChildren);

    const gen = GENERATORS[type];
    if (gen) return gen(element);

    // JavaScript step/rule: raw script.
    if (typeof element.script === 'string') return element.script;
    return null;
}

/* IteratorProperties.getScript = pre + iteration + post (children joined).
   A pragmatic port: pre = child list-decls, iteration = the for-loop with each
   child's script, post = child .put(...toArray()) lines. Nested iterators use
   the same for-loop shape. Sufficient for the design-time preview. */
function iteratorScript(element, getChildren) {
    const props = element.properties || element;
    const target = props.target ?? '';
    const idx = props.indexVariable || 'i';
    const kids = (typeof getChildren === 'function' ? getChildren(element) : (props.children || [])) || [];
    const enabled = kids.filter((c) => c && c.enabled !== false);

    const pre = enabled.map((c) => iterPre(c)).filter(Boolean).map((s) => s + '\n').join('');
    const body = enabled.map((c) => '\n' + (iterIteration(c, getChildren) ?? generateElementScript(c, getChildren) ?? '') + '\n').join('');
    const post = enabled.map((c) => iterPost(c)).filter(Boolean).map((s) => s + '\n').join('');

    return pre
        + `for (var ${idx} = 0; ${idx} < getArrayOrXmlLength(${target}); ${idx}++) {\n${body}\n}\n`
        + post;
}

/* Iterable child pre/iteration/post (Mapper/XSLT declare list accumulators). */
function iterPre(el) {
    if (el.__type === 'com.mirth.connect.plugins.mapper.MapperStep')
        return `var _${convertIdentifier(el.variable)} = Lists.list();`;
    if (el.__type === 'com.mirth.connect.plugins.xsltstep.XsltStep')
        return `var _${convertIdentifier(el.resultVariable)} = Lists.list();`;
    return null;
}
function iterIteration(el, getChildren) {
    if (el.__type === 'com.mirth.connect.plugins.mapper.MapperStep') {
        const mapping = (el.mapping && String(el.mapping).trim()) ? el.mapping : "''";
        const def = (el.defaultValue && String(el.defaultValue).length) ? el.defaultValue : "''";
        return `var mapping;\n\ntry {\n\tmapping = ${mapping}; \n} catch (e) {\n\tmapping = '';\n}\n\n`
            + `_${convertIdentifier(el.variable)}.add(validate( mapping , ${def}, ${buildRegexArray(el)}));`;
    }
    if (el.__type === 'com.mirth.connect.plugins.xsltstep.XsltStep') {
        return xsltScript(el).replace(/channelMap\.put\([^\n]*\n$/, `_${convertIdentifier(el.resultVariable)}.add(resultVar.toString());`);
    }
    if (ITERATOR_TYPES.has(el.__type)) return iteratorScript(el, getChildren);
    return null;   // non-iterable child -> caller uses getScript
}
function iterPost(el) {
    if (el.__type === 'com.mirth.connect.plugins.mapper.MapperStep') {
        const scopeMap = SCOPE_MAP[el.scope] || SCOPE_MAP.CHANNEL;
        return `${scopeMap}.put('${el.variable ?? ''}', _${convertIdentifier(el.variable)}.toArray());`;
    }
    if (el.__type === 'com.mirth.connect.plugins.xsltstep.XsltStep')
        return `channelMap.put('${el.resultVariable ?? ''}', _${convertIdentifier(el.resultVariable)}.toArray());`;
    return null;
}
