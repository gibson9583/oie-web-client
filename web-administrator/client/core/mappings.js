/*
 * Shared variable-reference lists shown beside code editors: the classic
 * Administrator's "Destination Mappings" velocity tokens (connector templates)
 * and the Rhino scope cheat-sheet for channel scripts (filter/transformer steps,
 * auth scripts). Each entry is [label, insertText].
 */

export const DESTINATION_MAPPINGS = [
    ['Channel ID', '${channelId}'],
    ['Channel Name', '${channelName}'],
    ['Message ID', '${message.messageId}'],
    ['Raw Data', '${message.rawData}'],
    ['Transformed Data', '${message.transformedData}'],
    ['Encoded Data', '${message.encodedData}'],
    ['Message Source', '${message.source}'],
    ['Message Type', '${message.type}'],
    ['Message Version', '${message.version}'],
    ['Date', '${date}'],
    ['Formatted Date', "${date.get('yyyy-M-d H.m.s')}"],
    ['Timestamp', '${SYSTIME}'],
    ['Unique ID', '${UUID}'],
    ['Original File Name', '${originalFilename}'],
    ['Count', '${COUNT}'],
    ['XML Entity Encoder', '${XmlUtil.encode()}'],
    ['XML Pretty Printer', '${XmlUtil.prettyPrint()}'],
    ['Escape JSON String', '${JsonUtil.escape()}'],
    ['JSON Pretty Printer', '${JsonUtil.prettyPrint()}'],
    ['CDATA Tag', '<![CDATA[]]>'],
    ['DICOM Message Raw Data', '${DICOMMESSAGE}']
];

/* Rhino script scope — the identifiers available inside filter/transformer steps
   and channel scripts (JavaScript context). */
export const SCRIPT_REFERENCE = [
    ['Incoming Message', 'msg'],
    ['Transformed Message', 'tmp'],
    ['Connector Message', 'connectorMessage'],
    ['Channel ID', 'channelId'],
    ['Channel Name', 'channelName'],
    ['Channel Map', "$c('key')"],
    ['Channel Map (put)', "$c('key', value)"],
    ['Source Map', "$s('key')"],
    ['Global Map', "$g('key')"],
    ['Global Channel Map', "$gc('key')"],
    ['Response Map', "$r('key')"],
    ['Configuration Map', "$cfg('key')"],
    ['Attachments', 'getAttachments()'],
    ['Logger', "logger.info('')"],
    ['Unique ID', 'UUIDGenerator.getUUID()'],
    ['Date Util', "DateUtil.getCurrentDate('yyyyMMddHHmmss')"]
];
