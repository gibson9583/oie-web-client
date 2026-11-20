// Java class names used by the engine to serialize transformer steps and filter rules.
export const ElementType = {
    JavaScriptStep: 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep',
    Mapper: 'com.mirth.connect.plugins.mapper.MapperStep',
    MessageBuilder: 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep',
    Xslt: 'com.mirth.connect.plugins.xsltstep.XsltStep',
    DestinationSetFilter: 'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep',
    ExternalScriptStep: 'com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep',
    IteratorStep: 'com.mirth.connect.model.IteratorStep',
    JavaScriptRule: 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule',
    RuleBuilder: 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule',
    ExternalScriptRule: 'com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule',
    IteratorRule: 'com.mirth.connect.model.IteratorRule'
} as const;

export function isElementEnabled(element: Record<string, unknown> | null | undefined): boolean {
    return element != null && element.enabled !== false && element.enabled !== 'false';
}
