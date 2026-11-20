export declare const ElementType: {
    readonly JavaScriptStep: 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
    readonly Mapper: 'com.mirth.connect.plugins.mapper.MapperStep';
    readonly MessageBuilder: 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep';
    readonly Xslt: 'com.mirth.connect.plugins.xsltstep.XsltStep';
    readonly DestinationSetFilter: 'com.mirth.connect.plugins.destinationsetfilter.DestinationSetFilterStep';
    readonly ExternalScriptStep: 'com.mirth.connect.plugins.scriptfilestep.ExternalScriptStep';
    readonly IteratorStep: 'com.mirth.connect.model.IteratorStep';
    readonly JavaScriptRule: 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule';
    readonly RuleBuilder: 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule';
    readonly ExternalScriptRule: 'com.mirth.connect.plugins.scriptfilerule.ExternalScriptRule';
    readonly IteratorRule: 'com.mirth.connect.model.IteratorRule';
};
export declare function isElementEnabled(element: Record<string, unknown> | null | undefined): boolean;
