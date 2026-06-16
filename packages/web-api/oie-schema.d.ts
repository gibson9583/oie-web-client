export interface paths {
    "/connectors/doc/_testWrite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Tests whether a file can be written to the specified directory. */
        post: operations["testWrite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/file/_testWrite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Tests whether a file can be written to the specified directory. */
        post: operations["testWrite_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/file/_testRead": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Tests whether a file can be read from the specified directory. */
        post: operations["testRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/http/_testConnection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Tests whether a connection can be successfully established to the destination endpoint. */
        post: operations["testConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/jdbc/_getTables": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Executes a query to retrieve database table metadata. */
        post: operations["getTables"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/jms/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves JMS connector settings templates. */
        get: operations["getTemplates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/jms/templates/{templateName}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves a single JMS connector settings template. */
        get: operations["getTemplate"];
        /** Creates or updates a JMS connector settings template. */
        put: operations["saveTemplate"];
        post?: never;
        /** Creates or updates a JMS connector settings template. */
        delete: operations["deleteTemplate"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/smtp/_sendTestEmail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sends a test e-mail, replacing any connector properties first. */
        post: operations["sendTestEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/tcp/_testConnection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Tests whether a connection can be successfully established to the destination endpoint. */
        post: operations["testConnection_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/ws/_getDefinition": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retrieves the definition service map corresponding to the specified WSDL. */
        post: operations["getDefinition"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/ws/_isWsdlCached": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Returns true if the definition tree for the WSDL is cached by the server. */
        post: operations["isWsdlCached"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/ws/_getSoapAction": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retrieves the default SOAP Action (URI string) for a given WSDL operation. */
        post: operations["getSoapAction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/ws/_generateEnvelope": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate SOAP envelope for a given WSDL operation. */
        post: operations["generateEnvelope"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/ws/_testConnection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Tests whether a connection can be successfully established to the destination endpoint. */
        post: operations["testConnection_2"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/connectors/ws/_cacheWsdlFromUrl": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Downloads the WSDL at the specified URL and caches the web service definition tree. */
        post: operations["cacheWsdlFromUrl"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/dashboardstatus/channelStates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves all dashboard channel states. */
        get: operations["getChannelStates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/dashboardstatus/channelStates/{channelId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves a single dashboard channel state. */
        get: operations["getChannelState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/dashboardstatus/connectionLogs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves connection logs for all channels. */
        get: operations["getAllChannelLogs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/dashboardstatus/connectionLogs/{channelId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves connection logs for a specific channel. */
        get: operations["getChannelLog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/dashboardstatus/connectorStates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves all dashboard connector states. */
        get: operations["getConnectorStateMap"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/datapruner/_start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Starts the data pruner on-demand. */
        post: operations["start"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/datapruner/_stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stops the data pruner if currently running. */
        post: operations["stop"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/datapruner/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves the current data pruner status. */
        get: operations["getStatusMap"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/directoryresource/resources/{resourceId}/libraries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves all library URLs for the given directory resource. */
        get: operations["getLibraries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/globalmapviewer/maps/all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves global and/or global channel map information. */
        get: operations["getAllMaps"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/globalmapviewer/maps/_getAllMaps": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retrieves global and/or global channel map information. This is a POST request alternative to GET /maps/all that may be used when there are too many channel IDs to include in the query parameters. */
        post: operations["getAllMapsPost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/globalmapviewer/maps/{channelId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves global channel map information for a single channel. */
        get: operations["getGlobalChannelMap"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/globalmapviewer/maps/global": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves global map information. */
        get: operations["getGlobalMap"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/serverlog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves server log entries. */
        get: operations["getServerLogs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/alerts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves multiple alerts by ID, or all alerts if not specified. */
        get: operations["getAlerts"];
        put?: never;
        /** Creates a new alert. */
        post: operations["createAlert"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/alerts/_getAlerts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retrieves multiple alerts by ID, or all alerts if not specified. This is a POST request alternative to GET /alerts that may be used when there are too many alert IDs to include in the query parameters. */
        post: operations["getAlertsPost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/alerts/{alertId}/_getInfo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Returns an AlertInfo object containing the alert model, alert protocol options, and any updated channel summaries. */
        post: operations["getAlertInfo"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/alerts/_getInfo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Returns an AlertInfo object containing alert protocol options and any updated channel summaries. */
        post: operations["getAlertInfo_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/alerts/options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns all alert protocol options. */
        get: operations["getAlertProtocolOptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/alerts/{alertId}/_enable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enables the specified alert. */
        post: operations["enableAlert"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/alerts/{alertId}/_disable": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disables the specified alert. */
        post: operations["disableAlert"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/alerts/{alertId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves an alert by ID. */
        get: operations["getAlert"];
        /** Updates the specified alert. */
        put: operations["updateAlert"];
        post?: never;
        /** Removes the specified alert. */
        delete: operations["removeAlert"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/alerts/statuses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns all alert dashboard statuses. */
        get: operations["getAlertStatusList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channelgroups/_getChannelGroups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retrieve a list of all channel groups, or multiple channel groups by ID. This is a POST request alternative to GET /channelgroups that may be used when there are too many channel group IDs to include in the query parameters. */
        post: operations["getChannelGroupsPost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channelgroups/_bulkUpdate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Updates all channel groups in one request. ("Try it out" doesn't work for this endpoint, but the descriptions are valid. Please use another tool for testing.) */
        post: operations["updateChannelGroups"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channelgroups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieve a list of all channel groups, or multiple channel groups by ID. */
        get: operations["getChannelGroups"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieve a single channel by ID. */
        get: operations["getChannel"];
        /** Updates the specified channel. */
        put: operations["updateChannel"];
        post?: never;
        /** Removes the channel with the specified ID. */
        delete: operations["removeChannel"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_getChannels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retrieve a list of all channels, or multiple channels by ID. This is a POST request alternative to GET /channels that may be used when there are too many channel IDs to include in the query parameters. */
        post: operations["getChannelsPost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/idsAndNames": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a map of all channel IDs and names. */
        get: operations["getChannelIdsAndNames"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/portsInUse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a list of all listener ports in use throughout the channels. */
        get: operations["getChannelPortsInUse"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_removeChannels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Removes the channels with the specified IDs. This is a POST request alternative to DELETE /channels that may be used when there are too many channel IDs to include in the query parameters. */
        post: operations["removeChannelsPost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_getSummary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Returns a list of channel summaries, indicating to a client which channels have changed (been updated, deleted, undeployed, etc.). If a channel was modified, the entire Channel object will be returned. */
        post: operations["getChannelSummary"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_setEnabled": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enables/disables the specified channels. ("Try it Out" only works when submitting an array containing one element for this endpoint, but the descriptions are valid. If you want to modify multiple items at once, please use another tool for testing.) */
        post: operations["setChannelEnabled"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/enabled/{enabled}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enables/disables the specified channel. */
        post: operations["setChannelEnabled_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/initialState/{initialState}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sets the initial state for a single channel. */
        post: operations["setChannelInitialState"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_setInitialState": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sets the initial state for the specified channels. ("Try it Out" only works when submitting an array containing one element for this endpoint, but the descriptions are valid. If you want to modify multiple items at once, please use another tool for testing.) */
        post: operations["setChannelInitialState_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/connectorNames": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns all connector names for a channel. */
        get: operations["getConnectorNames"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieve a list of all channels, or multiple channels by ID. */
        get: operations["getChannels"];
        put?: never;
        /** Creates a new channel. */
        post: operations["createChannel"];
        /** Removes the channels with the specified IDs. */
        delete: operations["removeChannels"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/metaDataColumns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns all metadata columns for a channel. */
        get: operations["getMetaDataColumns"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/statistics/_getStatistics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Returns the Statistics for all channels. This is a POST request alternative to GET /statistics that may be used when there are too many channel IDs to include in the query parameters. */
        post: operations["getStatisticsPost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_clearAllStatistics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Clears all statistics (including lifetime) for all channels/connectors. */
        post: operations["clearAllStatistics"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/statistics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the Statistics for all channels. */
        get: operations["getStatistics"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/statistics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the Statistics for the channel with the specified id. */
        get: operations["getStatistics_1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_clearStatistics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Clears the statistics for the given channels and/or connectors. */
        post: operations["clearStatistics"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/statuses/_getChannelStatusList": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Returns all channel dashboard statuses, or multiple statuses by channel ID. This is a POST request alternative to GET /statuses that may be used when there are too many channel IDs to include in the query parameters. */
        post: operations["getChannelStatusListPost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/statuses/initial": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a DashboardChannelInfo object containing a partial channel status list and a set of remaining channel IDs. */
        get: operations["getDashboardChannelInfo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_startConnectors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Starts the connectors with the specified channel and metadata IDs. */
        post: operations["startConnectors"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/_start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Starts the channel with the specified ID. */
        post: operations["startChannel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/_stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stops the channel with the specified ID. */
        post: operations["stopChannel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/_halt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Halts the channel with the specified ID. */
        post: operations["haltChannel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/_pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pauses the channel with the specified ID. */
        post: operations["pauseChannel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/_resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resumes the channel with the specified ID. */
        post: operations["resumeChannel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_stopConnectors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stops the connectors with the specified channel and metadata IDs. */
        post: operations["stopConnectors"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Starts the channels with the specified IDs. ("Try it Out" only works when submitting an array containing one element for this endpoint, but the descriptions are valid. If you want to modify multiple items at once, please use another tool for testing.) */
        post: operations["startChannels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stops the channels with the specified IDs. ("Try it Out" only works when submitting an array containing one element for this endpoint, but the descriptions are valid. If you want to modify multiple items at once, please use another tool for testing.) */
        post: operations["stopChannels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Pauses the channels with the specified IDs. ("Try it Out" only works when submitting an array containing one element for this endpoint, but the descriptions are valid. If you want to modify multiple items at once, please use another tool for testing.) */
        post: operations["pauseChannels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resume the channels with the specified IDs. ("Try it Out" only works when submitting an array containing one element for this endpoint, but the descriptions are valid. If you want to modify multiple items at once, please use another tool for testing.) */
        post: operations["resumeChannels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/connector/{metaDataId}/_start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Starts the connector with the specified channel and metadata ID. */
        post: operations["startConnector"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/connector/{metaDataId}/_stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stops the connector with the specified channel and metadata ID. */
        post: operations["stopConnector"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_halt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Halts the channels with the specified IDs. ("Try it Out" only works when submitting an array containing one element for this endpoint, but the descriptions are valid. If you want to modify multiple items at once, please use another tool for testing.) */
        post: operations["haltChannels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/statuses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns all channel dashboard statuses, or multiple statuses by channel ID. */
        get: operations["getChannelStatusList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the dashboard status for a single channel ID. */
        get: operations["getChannelStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/codeTemplateLibraries/_getCodeTemplateLibraries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retrieves multiple code template libraries by ID, or all libraries if not specified. This is a POST request alternative to GET /codeTemplateLibraries that may be used when there are too many library IDs to include in the query parameters. */
        post: operations["getCodeTemplateLibrariesPost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/codeTemplateLibraries": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves multiple code template libraries by ID, or all libraries if not specified. */
        get: operations["getCodeTemplateLibraries"];
        /** Replaces all code template libraries. */
        put: operations["updateCodeTemplateLibraries"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/codeTemplateLibraries/{libraryId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves a single code template library. */
        get: operations["getCodeTemplateLibrary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/codeTemplates/_getCodeTemplates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retrieves multiple code templates by ID, or all templates if not specified. This is a POST request alternative to GET /codeTemplates that may be used when there are too many code template IDs to include in the query parameters. */
        post: operations["getCodeTemplatesPost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/codeTemplates/{codeTemplateId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves a single code template. */
        get: operations["getCodeTemplate"];
        /** Updates a single code template. */
        put: operations["updateCodeTemplate"];
        post?: never;
        /** Removes a single code template. */
        delete: operations["removeCodeTemplate"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/codeTemplateLibraries/_bulkUpdate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Updates all libraries and updates/removes selected code templates in one request. ("Try it out" doesn't work for this endpoint, but the descriptions are valid. Please use another tool for testing.) */
        post: operations["updateLibrariesAndTemplates"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/codeTemplates/_getSummary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Returns a list of code template summaries, indicating to a client which code templates have changed. If a code template was modified, the entire CodeTemplate object will be returned. */
        post: operations["getCodeTemplateSummary"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/codeTemplates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves multiple code templates by ID, or all templates if not specified. */
        get: operations["getCodeTemplates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/property": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a property from the configuration table. */
        get: operations["getProperty"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/resources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns all resources for the server. */
        get: operations["getResources"];
        /** Updates all resources for the server. */
        put: operations["setResources"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/version": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the version of the server. */
        get: operations["getVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/protocolsAndCipherSuites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a map containing all supported and enabled TLS protocols and cipher suites. */
        get: operations["getProtocolsAndCipherSuites"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/jvm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the name of the JVM running the server. */
        get: operations["getJVMName"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/about": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a map of common information about the server. */
        get: operations["getAbout"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/licenseInfo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a LicenseInfo object with the expiration date and other information. */
        get: operations["getLicenseInfo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/_generateGUID": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Returns a globally unique id. */
        post: operations["getGuid"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/time": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the time of the server. */
        get: operations["getServerTime"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/buildDate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the build date of the server. */
        get: operations["getBuildDate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/_testEmail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Sends a test e-mail. */
        post: operations["sendTestEmail_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/rhinoLanguageVersion": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the language version that the Rhino engine should use. */
        get: operations["getRhinoLanguageVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/charsets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a List of all of the charset encodings supported by the server. */
        get: operations["getAvailableCharsetEncodings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/publicSettings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a PublicServerSettings object containing server settings available to all users. */
        get: operations["getPublicServerSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/passwordRequirements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns all password requirements for the server. */
        get: operations["getPasswordRequirements"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/encryption": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns an EncryptionSettings object with all encryption settings. */
        get: operations["getEncryptionSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/timezone": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the time zone of the server. */
        get: operations["getServerTimezone"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/databaseDrivers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the database driver list. */
        get: operations["getDatabaseDrivers"];
        /** Updates the list of database drivers. */
        put: operations["setDatabaseDrivers"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/configuration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a ServerConfiguration object which contains all of the channels, alerts, configuration map, and properties stored on the server. */
        get: operations["getServerConfiguration"];
        /** Updates all of the channels, alerts and properties stored on the server. */
        put: operations["setServerConfiguration"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/channelMetadata": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns all channel metadata for the server. */
        get: operations["getChannelMetadata"];
        /** Updates all channel metadata for the server. */
        put: operations["setChannelMetadata"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/resources/{resourceId}/_reload": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reloads a resource and all libraries associated with it. */
        post: operations["reloadResource"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a ServerSettings object with all server settings. */
        get: operations["getServerSettings"];
        /** Updates the server configuration settings. */
        put: operations["setServerSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/configurationMap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns all entries in the configuration map. */
        get: operations["getConfigurationMap"];
        /** Updates all entries in the configuration map. */
        put: operations["setConfigurationMap"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/channelTags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a set containing all channel tags for the server. */
        get: operations["getChannelTags"];
        /** Updates all channel tags. */
        put: operations["setChannelTags"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/updateSettings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns an UpdateSettings object with all update settings. */
        get: operations["getUpdateSettings"];
        /** Updates the update settings. */
        put: operations["setUpdateSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/globalScripts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a map containing all of the global scripts. */
        get: operations["getGlobalScripts"];
        /** Updates all of the global scripts. */
        put: operations["setGlobalScripts"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/channelDependencies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns all channel dependencies for the server. */
        get: operations["getChannelDependencies"];
        /** Updates all channel dependencies for the server. */
        put: operations["setChannelDependencies"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/id": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the server id. */
        get: operations["getServerId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/server/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the status of the server. */
        get: operations["getStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/databaseTasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves all current database tasks. */
        get: operations["getDatabaseTasks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/databaseTasks/{databaseTaskId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves a single database task. */
        get: operations["getDatabaseTask"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/databaseTasks/{databaseTaskId}/_run": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Executes the specified database task. */
        post: operations["runDatabaseTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/databaseTasks/{databaseTaskId}/_cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Cancels execution of the specified database task. */
        post: operations["cancelDatabaseTask"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/_undeploy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Undeploys a single channel. */
        post: operations["undeployChannel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/_deploy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Deploys (or redeploys) a single channel. */
        post: operations["deployChannel"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_deploy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Deploys (or redeploys) selected channels. */
        post: operations["deployChannels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_undeploy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Undeploys selected channels. */
        post: operations["undeployChannels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_redeployAll": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Redeploys all channels. */
        post: operations["redeployAllChannels"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search for events by specific filter criteria. */
        get: operations["getEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/_search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Search for events by specific filter criteria. */
        post: operations["getEvents_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/count/_search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Count number for events by specific filter criteria. */
        post: operations["getEventCount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/count": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Count number for events by specific filter criteria. */
        get: operations["getEventCount_1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/_export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Exports all events to the application data directory on the server. */
        post: operations["exportAllEvents"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/maxEventId": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the maximum event ID currently in the database. */
        get: operations["getMaxEventId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/events/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieves an event by ID. */
        get: operations["getEvent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/_install": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Installs an extension. */
        post: operations["installExtension"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/_uninstall": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Uninstalls an extension. */
        post: operations["uninstallExtension"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/{extensionName}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns extension metadata by name. */
        get: operations["getExtensionMetaData"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/{extensionName}/enabled": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the enabled status of an extension. */
        get: operations["isExtensionEnabled"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/{extensionName}/_setEnabled": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Enables or disables an extension. */
        post: operations["setExtensionEnabled"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/disabled": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the disabled extensions on the classpath. */
        get: operations["getDisabledExtensions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/connectors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns all active connector metadata. */
        get: operations["getConnectorMetaData"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/plugins": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns all active plugin metadata. */
        get: operations["getPluginMetaData"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extensions/{extensionName}/properties": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns filtered properties for a specified extension. */
        get: operations["getPluginProperties"];
        /** Sets properties for a specified extension. */
        put: operations["setPluginProperties"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/{messageId}/attachments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieve a list of attachments by message ID. */
        get: operations["getAttachmentsByMessageId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/{messageId}/_getDICOMMessage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Given a ConnectorMessage object, reattaches any DICOM attachment data and returns the raw Base64 encoded message data. */
        post: operations["getDICOMMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/count/_search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Count number for messages by specific filter criteria. */
        post: operations["getMessageCount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/count": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Count number for messages by specific filter criteria. */
        get: operations["getMessageCount_1"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/_reprocessWithFilter": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reprocesses messages through a channel filtering with a MessageFilter. */
        post: operations["reprocessMessages"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/_reprocess": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reprocesses messages through a channel by specific filter criteria. */
        post: operations["reprocessMessages_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/{messageId}/_reprocess": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Reprocesses and overwrites a single message. */
        post: operations["reprocessMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_removeAllMessagesPost": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Removes all messages for multiple specified channels. This is a POST request alternative to DELETE /_removeAllMessages that may be used when there are too many channel IDs to include in the query parameters. */
        post: operations["removeAllMessagesPost"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/_importFromPath": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Imports messages into a channel from a path accessible by the server. The messages will not actually be processed through the channel, only imported. */
        post: operations["importMessagesServer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/_export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Exports messages into a specific directory path accessible by the server. */
        post: operations["exportMessagesServer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/_exportUsingFilter": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Exports messages into a specific directory path accessible by the server. ("Try it out" doesn't work for this endpoint, but the descriptions are valid. Please use another tool for testing.) */
        post: operations["exportMessagesServer_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/{messageId}/attachments/{attachmentId}/_export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Exports a message attachment into a specific file path accessible by the server. */
        post: operations["exportAttachmentServer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_auditQueriedPHIMessage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Audit that the user has queried the channel messages panel that contains PHI. */
        post: operations["auditQueriedPHIMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_auditExportMessages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Audit that the user has exported channel messages. */
        post: operations["auditExportMessages"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search for messages by specific filter criteria. */
        get: operations["getMessages"];
        put?: never;
        /** Processes a new message through a channel. */
        post: operations["processMessage"];
        /** Remove messages by specific filter criteria. */
        delete: operations["removeMessages_1"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messagesWithObj": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Processes a new message through a channel, using the RawMessage object. */
        post: operations["processMessage_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/{messageId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieve a message by ID. */
        get: operations["getMessageContent"];
        put?: never;
        post?: never;
        /** Remove a single message by ID. */
        delete: operations["removeMessage"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/_import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Imports a Message object into a channel. The message will not actually be processed through the channel, only imported. */
        post: operations["importMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_auditAccessedPHIMessage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Audit that the user has accessed a channel message that contains PHI. */
        post: operations["auditAccessedPHIMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_auditExportMessagesSuccess": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Audit that the user has successfully exported channel messages. */
        post: operations["auditExportMessagesSuccess"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/_search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Search for messages by specific filter criteria. */
        post: operations["getMessages_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/_remove": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Remove messages by specific filter criteria. */
        post: operations["removeMessages"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/_removeAllMessages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Removes all messages for multiple specified channels. */
        delete: operations["removeAllMessages"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/_removeAll": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Removes all messages for the specified channel. */
        delete: operations["removeAllMessages_1"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/{messageId}/attachments/{attachmentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Retrieve a message attachment by ID. */
        get: operations["getAttachment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/channels/{channelId}/messages/maxMessageId": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the maximum message ID for the given channel. */
        get: operations["getMaxMessageId"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/system/info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns information about the underlying system. */
        get: operations["getInfo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/system/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns statistics for the underlying system. */
        get: operations["getStats"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/usageData/_generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generates usage document using data from both the client and server. */
        post: operations["getUsageData"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/_inactivityLogout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** User has been inactive and automatically logged out. */
        post: operations["inactivityLogout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/_checkPassword": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Checks the password against the configured password policies. */
        post: operations["checkUserPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a List of all users. */
        get: operations["getAllUsers"];
        put?: never;
        /** Creates a new user. */
        post: operations["createUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{userId}/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Updates a user's password. */
        put: operations["updateUserPassword"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns the current logged in user. */
        get: operations["getCurrentUser"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{userIdOrName}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a specific user by ID or username. */
        get: operations["getUser"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Updates a specified user. */
        put: operations["updateUser"];
        post?: never;
        /** Removes a specific user. */
        delete: operations["removeUser"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{userId}/loggedIn": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a true if the specified user is logged in to the server. */
        get: operations["isUserLoggedIn"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{userId}/preferences/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a specific user preference. */
        get: operations["getUserPreference"];
        /** Updates a user preference. */
        put: operations["setUserPreference"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{userId}/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Returns a Map of user preferences, optionally filtered by a set of property names. */
        get: operations["getUserPreferences"];
        /** Updates multiple user preferences. */
        put: operations["setUserPreferences"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/_login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Logs in to the server using the specified name and password. */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/_logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Logs out of the server. */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{userId}/notificationAcknowledged": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** User notification has been acknowledged. */
        post: operations["setUserNotificationAcknowledged"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/getDefinition": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Retrieves the definition service map corresponding to the specified WSDL. */
        post: operations["getDefinition_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/_isWsdlCached": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Returns true if the definition tree for the WSDL is cached by the server. */
        post: operations["isWsdlCached_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/keystore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getKeystore"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/truststore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Overwrite the in use truststore */
        post: operations["setTruststore"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/importedcertificates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getPublicCertificates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/clientcertificates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getClientCertificates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/systemCertificates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getSystemCertificates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/remoteCertificates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getRemoteCertificates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/testHttpsConnection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Tests whether a connection can be successfully established to the destination endpoint. */
        post: operations["testHttpsConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/trustedCertificates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getTrustedCertificates"];
        /** Overwrite the trusted certificates within the in use truststore */
        put: operations["setTrustedCertificates"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/localCertificates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getLocalCertificates"];
        /** Overwrite the local certificates within the in use keystore */
        put: operations["setLocalCertificates"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/testTcpConnection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Tests whether a connection can be successfully established to the destination endpoint. */
        post: operations["testTcpConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/testWsConnection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Tests whether a connection can be successfully established to the destination endpoint. */
        post: operations["testWsConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/tlsmanager/_cacheWsdlFromUrl": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Downloads the WSDL at the specified URL and caches the web service definition tree. */
        post: operations["cacheWsdlFromUrl_1"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        ConnectionTestResponse: {
            /** @enum {string} */
            type?: "SUCCESS" | "TIME_OUT" | "FAILURE";
            message?: string;
            connectionInfo?: string;
        };
        ConnectorPluginProperties: {
            name?: string;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        DestinationConnectorProperties: {
            queueEnabled?: boolean;
            sendFirst?: boolean;
            /** Format: int32 */
            retryIntervalMillis?: number;
            regenerateTemplate?: boolean;
            /** Format: int32 */
            retryCount?: number;
            rotate?: boolean;
            includeFilterTransformer?: boolean;
            /** Format: int32 */
            threadCount?: number;
            threadAssignmentVariable?: string;
            validateResponse?: boolean;
            resourceIds?: {
                [key: string]: string;
            };
            /** Format: int32 */
            queueBufferSize?: number;
            reattachAttachments?: boolean;
            pluginProperties?: components["schemas"]["ConnectorPluginProperties"][];
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        FileDispatcherProperties: {
            pluginProperties?: components["schemas"]["ConnectorPluginProperties"][];
            destinationConnectorProperties?: components["schemas"]["DestinationConnectorProperties"];
            /** @enum {string} */
            scheme?: "file" | "ftp" | "sftp" | "Amazon S3" | "smb" | "webdav";
            schemeProperties?: components["schemas"]["SchemeProperties"];
            host?: string;
            outputPattern?: string;
            anonymous?: boolean;
            username?: string;
            password?: string;
            timeout?: string;
            keepConnectionOpen?: boolean;
            maxIdleTime?: string;
            secure?: boolean;
            passive?: boolean;
            validateConnection?: boolean;
            outputAppend?: boolean;
            errorOnExists?: boolean;
            temporary?: boolean;
            binary?: boolean;
            charsetEncoding?: string;
            template?: string;
            name?: string;
            protocol?: string;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        SchemeProperties: {
            summaryText?: string;
            fileSchemeProperties?: components["schemas"]["SchemeProperties"];
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        CronProperty: {
            description?: string;
            expression?: string;
        };
        FileReceiverProperties: {
            pluginProperties?: components["schemas"]["ConnectorPluginProperties"][];
            pollConnectorProperties?: components["schemas"]["PollConnectorProperties"];
            sourceConnectorProperties?: components["schemas"]["SourceConnectorProperties"];
            /** @enum {string} */
            scheme?: "file" | "ftp" | "sftp" | "Amazon S3" | "smb" | "webdav";
            schemeProperties?: components["schemas"]["SchemeProperties"];
            host?: string;
            fileFilter?: string;
            regex?: boolean;
            directoryRecursion?: boolean;
            ignoreDot?: boolean;
            anonymous?: boolean;
            username?: string;
            password?: string;
            timeout?: string;
            secure?: boolean;
            passive?: boolean;
            validateConnection?: boolean;
            /** @enum {string} */
            afterProcessingAction?: "None" | "Move" | "Delete" | "After Processing Action";
            moveToDirectory?: string;
            moveToFileName?: string;
            /** @enum {string} */
            errorReadingAction?: "None" | "Move" | "Delete" | "After Processing Action";
            /** @enum {string} */
            errorResponseAction?: "None" | "Move" | "Delete" | "After Processing Action";
            errorMoveToDirectory?: string;
            errorMoveToFileName?: string;
            checkFileAge?: boolean;
            fileAge?: string;
            fileSizeMinimum?: string;
            fileSizeMaximum?: string;
            ignoreFileSizeMaximum?: boolean;
            sortBy?: string;
            binary?: boolean;
            charsetEncoding?: string;
            name?: string;
            protocol?: string;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        PollConnectorProperties: {
            /** @enum {string} */
            pollingType?: "INTERVAL" | "TIME" | "CRON";
            pollOnStart?: boolean;
            /** Format: int32 */
            pollingFrequency?: number;
            /** Format: int32 */
            pollingHour?: number;
            /** Format: int32 */
            pollingMinute?: number;
            cronJobs?: components["schemas"]["CronProperty"][];
            pollConnectorPropertiesAdvanced?: components["schemas"]["PollConnectorPropertiesAdvanced"];
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        PollConnectorPropertiesAdvanced: {
            weekly?: boolean;
            inactiveDays?: boolean[];
            /** Format: int32 */
            dayOfMonth?: number;
            allDay?: boolean;
            /** Format: int32 */
            startingHour?: number;
            /** Format: int32 */
            startingMinute?: number;
            /** Format: int32 */
            endingHour?: number;
            /** Format: int32 */
            endingMinute?: number;
            activeDays?: boolean[];
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        SourceConnectorProperties: {
            responseVariable?: string;
            respondAfterProcessing?: boolean;
            processBatch?: boolean;
            firstResponse?: boolean;
            /** Format: int32 */
            processingThreads?: number;
            resourceIds?: {
                [key: string]: string;
            };
            /** Format: int32 */
            queueBufferSize?: number;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        HttpDispatcherProperties: {
            pluginProperties?: components["schemas"]["ConnectorPluginProperties"][];
            destinationConnectorProperties?: components["schemas"]["DestinationConnectorProperties"];
            host?: string;
            useProxyServer?: boolean;
            proxyAddress?: string;
            proxyPort?: string;
            method?: string;
            useHeadersVariable?: boolean;
            headersVariable?: string;
            useParametersVariable?: boolean;
            parametersVariable?: string;
            responseXmlBody?: boolean;
            responseParseMultipart?: boolean;
            responseIncludeMetadata?: boolean;
            responseBinaryMimeTypes?: string;
            responseBinaryMimeTypesRegex?: boolean;
            multipart?: boolean;
            useAuthentication?: boolean;
            authenticationType?: string;
            usePreemptiveAuthentication?: boolean;
            username?: string;
            password?: string;
            content?: string;
            contentType?: string;
            dataTypeBinary?: boolean;
            charset?: string;
            socketTimeout?: string;
            name?: string;
            protocol?: string;
            headersMap?: {
                [key: string]: string[];
            };
            parametersMap?: {
                [key: string]: string[];
            };
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        Column: {
            name?: string;
            type?: string;
            /** Format: int32 */
            precision?: number;
        };
        Table: {
            name?: string;
            columns?: components["schemas"]["Column"][];
        };
        JmsConnectorProperties: {
            pluginProperties?: components["schemas"]["ConnectorPluginProperties"][];
            useJndi?: boolean;
            jndiProviderUrl?: string;
            jndiInitialContextFactory?: string;
            jndiConnectionFactoryName?: string;
            connectionFactoryClass?: string;
            connectionProperties?: {
                [key: string]: string;
            };
            username?: string;
            password?: string;
            destinationName?: string;
            topic?: boolean;
            clientId?: string;
            name?: string;
            protocol?: string;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        Attachment: {
            id?: string;
            content?: string[];
            type?: string;
            encryptionHeader?: string;
            attachmentId?: string;
            encrypted?: boolean;
        };
        SmtpDispatcherProperties: {
            pluginProperties?: components["schemas"]["ConnectorPluginProperties"][];
            destinationConnectorProperties?: components["schemas"]["DestinationConnectorProperties"];
            smtpHost?: string;
            smtpPort?: string;
            overrideLocalBinding?: boolean;
            localAddress?: string;
            localPort?: string;
            timeout?: string;
            encryption?: string;
            authentication?: boolean;
            username?: string;
            password?: string;
            to?: string;
            from?: string;
            cc?: string;
            bcc?: string;
            replyTo?: string;
            headersVariable?: string;
            subject?: string;
            charsetEncoding?: string;
            html?: boolean;
            body?: string;
            attachmentsVariable?: string;
            name?: string;
            protocol?: string;
            useAttachmentsVariable?: boolean;
            attachmentsList?: components["schemas"]["Attachment"][];
            headersMap?: {
                [key: string]: string;
            };
            useHeadersVariable?: boolean;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        TcpDispatcherProperties: {
            pluginProperties?: components["schemas"]["ConnectorPluginProperties"][];
            destinationConnectorProperties?: components["schemas"]["DestinationConnectorProperties"];
            transmissionModeProperties?: components["schemas"]["TransmissionModeProperties"];
            serverMode?: boolean;
            remoteAddress?: string;
            remotePort?: string;
            overrideLocalBinding?: boolean;
            localAddress?: string;
            localPort?: string;
            sendTimeout?: string;
            bufferSize?: string;
            maxConnections?: string;
            keepConnectionOpen?: boolean;
            checkRemoteHost?: boolean;
            responseTimeout?: string;
            ignoreResponse?: boolean;
            queueOnResponseTimeout?: boolean;
            dataTypeBinary?: boolean;
            charsetEncoding?: string;
            template?: string;
            name?: string;
            protocol?: string;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        TransmissionModeProperties: {
            pluginPointName?: string;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        DefinitionPortMap: {
            map?: {
                [key: string]: components["schemas"]["PortInformation"];
            };
        };
        DefinitionServiceMap: {
            map?: {
                [key: string]: components["schemas"]["DefinitionPortMap"];
            };
        };
        PortInformation: {
            operations?: string[];
            actions?: string[];
            locationURI?: string;
        };
        WebServiceDispatcherProperties: {
            pluginProperties?: components["schemas"]["ConnectorPluginProperties"][];
            destinationConnectorProperties?: components["schemas"]["DestinationConnectorProperties"];
            wsdlUrl?: string;
            service?: string;
            port?: string;
            operation?: string;
            locationURI?: string;
            socketTimeout?: string;
            useAuthentication?: boolean;
            username?: string;
            password?: string;
            envelope?: string;
            oneWay?: boolean;
            headersVariable?: string;
            useMtom?: boolean;
            attachmentNames?: string[];
            attachmentContents?: string[];
            attachmentTypes?: string[];
            attachmentsVariable?: string;
            soapAction?: string;
            wsdlDefinitionMap?: components["schemas"]["DefinitionServiceMap"];
            name?: string;
            protocol?: string;
            useAttachmentsVariable?: boolean;
            headersMap?: {
                [key: string]: string[];
            };
            useHeadersVariable?: boolean;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        ConnectionLogItem: {
            /** Format: int64 */
            logId?: number;
            serverId?: string;
            channelId?: string;
            /** Format: int64 */
            metadataId?: number;
            dateAdded?: string;
            channelName?: string;
            connectorType?: string;
            eventState?: string;
            information?: string;
        };
        ServerLogItem: {
            serverId?: string;
            /** Format: int64 */
            id?: number;
            level?: string;
            /** Format: date-time */
            date?: string;
            threadName?: string;
            category?: string;
            lineNumber?: string;
            message?: string;
            throwableInformation?: string;
        };
        AlertAction: {
            protocol?: string;
            recipient?: string;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        AlertActionGroup: {
            actions?: components["schemas"]["AlertAction"][];
            subject?: string;
            template?: string;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        AlertModel: {
            id?: string;
            name?: string;
            enabled?: boolean;
            trigger?: components["schemas"]["AlertTrigger"];
            actionGroups?: components["schemas"]["AlertActionGroup"][];
            properties?: {
                [key: string]: Record<string, never>;
            };
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        AlertTrigger: {
            name?: string;
        };
        AlertInfo: {
            model?: components["schemas"]["AlertModel"];
            protocolOptions?: {
                [key: string]: {
                    [key: string]: string;
                };
            };
            changedChannels?: components["schemas"]["ChannelSummary"][];
        };
        AttachmentHandlerProperties: {
            className?: string;
            type?: string;
            properties?: {
                [key: string]: string;
            };
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        BatchProperties: {
            batchScript?: string;
            properties?: {
                [key: string]: Record<string, never>;
            };
            propertyDescriptors?: {
                [key: string]: components["schemas"]["DataTypePropertyDescriptor"];
            };
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        Channel: {
            id?: string;
            /** Format: int32 */
            nextMetaDataId?: number;
            name?: string;
            description?: string;
            /** Format: int32 */
            revision?: number;
            sourceConnector?: components["schemas"]["Connector"];
            destinationConnectors?: components["schemas"]["Connector"][];
            preprocessingScript?: string;
            postprocessingScript?: string;
            deployScript?: string;
            undeployScript?: string;
            properties?: components["schemas"]["ChannelProperties"];
            exportData?: components["schemas"]["ChannelExportData"];
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
            enabledDestinationConnectors?: components["schemas"]["Connector"][];
        };
        ChannelExportData: {
            metadata?: components["schemas"]["ChannelMetadata"];
            codeTemplateLibraries?: components["schemas"]["CodeTemplateLibrary"][];
            dependentIds?: string[];
            dependencyIds?: string[];
            channelTags?: components["schemas"]["ChannelTag"][];
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        ChannelMetadata: {
            enabled?: boolean;
            /** Format: date-time */
            lastModified?: string;
            pruningSettings?: components["schemas"]["ChannelPruningSettings"];
            /** Format: int32 */
            userId?: number;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        ChannelProperties: {
            clearGlobalChannelMap?: boolean;
            /** @enum {string} */
            messageStorageMode?: "DEVELOPMENT" | "PRODUCTION" | "RAW" | "METADATA" | "DISABLED";
            encryptAttachments?: boolean;
            encryptCustomMetaData?: boolean;
            removeContentOnCompletion?: boolean;
            removeOnlyFilteredOnCompletion?: boolean;
            removeAttachmentsOnCompletion?: boolean;
            /** @enum {string} */
            initialState?: "Undeployed" | "Deploying" | "Undeploying" | "Starting" | "Started" | "Pausing" | "Paused" | "Stopping" | "Stopped" | "Syncing" | "Unknown";
            storeAttachments?: boolean;
            metaDataColumns?: components["schemas"]["MetaDataColumn"][];
            attachmentProperties?: components["schemas"]["AttachmentHandlerProperties"];
            resourceIds?: {
                [key: string]: string;
            };
            encryptMessageContent?: boolean;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        ChannelPruningSettings: {
            /** Format: int32 */
            pruneMetaDataDays?: number;
            /** Format: int32 */
            pruneContentDays?: number;
            archiveEnabled?: boolean;
            pruneErroredMessages?: boolean;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        ChannelStatus: {
            channel?: components["schemas"]["Channel"];
            /** Format: date-time */
            deployedDate?: string;
            /** Format: int32 */
            deployedRevisionDelta?: number;
            codeTemplatesChanged?: boolean;
            /** Format: int64 */
            localChannelId?: number;
        };
        ChannelSummary: {
            channelId?: string;
            deleted?: boolean;
            undeployed?: boolean;
            channelStatus?: components["schemas"]["ChannelStatus"];
        };
        ChannelTag: {
            id?: string;
            name?: string;
            channelIds?: string[];
            backgroundColor?: {
                /** Format: int32 */
                red?: number;
                /** Format: int32 */
                green?: number;
                /** Format: int32 */
                blue?: number;
                /** Format: int32 */
                alpha?: number;
                /** Format: int32 */
                rgb?: number;
                colorSpace?: {
                    /** Format: int32 */
                    type?: number;
                    /** Format: int32 */
                    numComponents?: number;
                    cs_sRGB?: boolean;
                };
                /** Format: int32 */
                transparency?: number;
            };
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        CodeTemplate: {
            id?: string;
            name?: string;
            /** Format: int32 */
            revision?: number;
            /** Format: date-time */
            lastModified?: string;
            contextSet?: ("Global Deploy" | "Global Undeploy" | "Global Preprocessor" | "Global Postprocessor" | "Channel Deploy" | "Channel Undeploy" | "Channel Preprocessor" | "Channel Postprocessor" | "Channel Attachment" | "Channel Batch" | "Source Receiver" | "Source Filter Transformer" | "Destination Filter Transformer" | "Destination Dispatcher" | "Destination Response Transformer")[];
            properties?: components["schemas"]["CodeTemplateProperties"];
            /** @enum {string} */
            type?: "Function" | "Drag-and-Drop Code Block" | "Compiled Code Block";
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
            addToScripts?: boolean;
            functionDefinition?: components["schemas"]["CodeTemplateFunctionDefinition"];
            code?: string;
            description?: string;
        };
        CodeTemplateContextSet: ("Global Deploy" | "Global Undeploy" | "Global Preprocessor" | "Global Postprocessor" | "Channel Deploy" | "Channel Undeploy" | "Channel Preprocessor" | "Channel Postprocessor" | "Channel Attachment" | "Channel Batch" | "Source Receiver" | "Source Filter Transformer" | "Destination Filter Transformer" | "Destination Dispatcher" | "Destination Response Transformer")[];
        CodeTemplateFunctionDefinition: {
            name?: string;
            parameters?: components["schemas"]["Parameter"][];
            returnType?: string;
            returnDescription?: string;
            transferData?: string;
        };
        CodeTemplateLibrary: {
            id?: string;
            name?: string;
            /** Format: int32 */
            revision?: number;
            /** Format: date-time */
            lastModified?: string;
            description?: string;
            includeNewChannels?: boolean;
            enabledChannelIds?: string[];
            disabledChannelIds?: string[];
            codeTemplates?: components["schemas"]["CodeTemplate"][];
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        CodeTemplateProperties: {
            /** @enum {string} */
            type?: "Function" | "Drag-and-Drop Code Block" | "Compiled Code Block";
            description?: string;
            functionDefinition?: components["schemas"]["CodeTemplateFunctionDefinition"];
            pluginPointName?: string;
            code?: string;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        Connector: {
            /** Format: int32 */
            metaDataId?: number;
            name?: string;
            properties?: components["schemas"]["ConnectorProperties"];
            transformer?: components["schemas"]["Transformer"];
            responseTransformer?: components["schemas"]["Transformer"];
            filter?: components["schemas"]["Filter"];
            transportName?: string;
            /** @enum {string} */
            mode?: "SOURCE" | "DESTINATION";
            enabled?: boolean;
            waitForPrevious?: boolean;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        ConnectorProperties: {
            pluginProperties?: components["schemas"]["ConnectorPluginProperties"][];
            name?: string;
            protocol?: string;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        DataTypeProperties: {
            serializationProperties?: components["schemas"]["SerializationProperties"];
            deserializationProperties?: components["schemas"]["DeserializationProperties"];
            batchProperties?: components["schemas"]["BatchProperties"];
            responseGenerationProperties?: components["schemas"]["ResponseGenerationProperties"];
            responseValidationProperties?: components["schemas"]["ResponseValidationProperties"];
            serializerProperties?: components["schemas"]["SerializerProperties"];
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        DataTypePropertyDescriptor: {
            value?: Record<string, never>;
            displayName?: string;
            description?: string;
            /** @enum {string} */
            editorType?: "STRING" | "BOOLEAN" | "JAVASCRIPT" | "OPTION";
            options?: Record<string, never>[];
        };
        DeserializationProperties: {
            /** @enum {string} */
            serializationType?: "RAW" | "XML" | "JSON";
            properties?: {
                [key: string]: Record<string, never>;
            };
            propertyDescriptors?: {
                [key: string]: components["schemas"]["DataTypePropertyDescriptor"];
            };
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        Filter: {
            elements?: components["schemas"]["Rule"][];
            enabledElements?: components["schemas"]["Rule"][];
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        MetaDataColumn: {
            name?: string;
            /** @enum {string} */
            type?: "STRING" | "NUMBER" | "BOOLEAN" | "TIMESTAMP";
            mappingName?: string;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        Parameter: {
            name?: string;
            type?: string;
            description?: string;
        };
        ResponseGenerationProperties: {
            properties?: {
                [key: string]: Record<string, never>;
            };
            propertyDescriptors?: {
                [key: string]: components["schemas"]["DataTypePropertyDescriptor"];
            };
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        ResponseValidationProperties: {
            properties?: {
                [key: string]: Record<string, never>;
            };
            propertyDescriptors?: {
                [key: string]: components["schemas"]["DataTypePropertyDescriptor"];
            };
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        Rule: {
            name?: string;
            sequenceNumber?: string;
            enabled?: boolean;
            /** @enum {string} */
            operator?: "AND" | "OR" | "NONE";
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
            type?: string;
            responseVariables?: string[];
        };
        SerializationProperties: {
            /** @enum {string} */
            serializationType?: "RAW" | "XML" | "JSON";
            properties?: {
                [key: string]: Record<string, never>;
            };
            propertyDescriptors?: {
                [key: string]: components["schemas"]["DataTypePropertyDescriptor"];
            };
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        SerializerProperties: {
            serializationProperties?: components["schemas"]["SerializationProperties"];
            deserializationProperties?: components["schemas"]["DeserializationProperties"];
            batchProperties?: components["schemas"]["BatchProperties"];
        };
        Step: {
            name?: string;
            sequenceNumber?: string;
            enabled?: boolean;
            type?: string;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
            responseVariables?: string[];
        };
        Transformer: {
            elements?: components["schemas"]["Step"][];
            inboundTemplate?: string;
            outboundTemplate?: string;
            inboundDataType?: string;
            outboundDataType?: string;
            inboundProperties?: components["schemas"]["DataTypeProperties"];
            outboundProperties?: components["schemas"]["DataTypeProperties"];
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
            enabledElements?: components["schemas"]["Step"][];
        };
        ChannelHeader: {
            /** Format: int32 */
            revision?: number;
            /** Format: date-time */
            deployedDate?: string;
            codeTemplatesChanged?: boolean;
        };
        AlertStatus: {
            id?: string;
            name?: string;
            enabled?: boolean;
            /** Format: int32 */
            alertedCount?: number;
        };
        ChannelGroup: {
            id?: string;
            name?: string;
            /** Format: int32 */
            revision?: number;
            /** Format: date-time */
            lastModified?: string;
            description?: string;
            channels?: components["schemas"]["Channel"][];
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        Ports: {
            name?: string;
            id?: string;
            port?: string;
        };
        ChannelStatistics: {
            serverId?: string;
            channelId?: string;
            /** Format: int64 */
            received?: number;
            /** Format: int64 */
            sent?: number;
            /** Format: int64 */
            error?: number;
            /** Format: int64 */
            filtered?: number;
            /** Format: int64 */
            queued?: number;
        };
        DashboardStatus: {
            channelId?: string;
            name?: string;
            /** @enum {string} */
            state?: "Undeployed" | "Deploying" | "Undeploying" | "Starting" | "Started" | "Pausing" | "Paused" | "Stopping" | "Stopped" | "Syncing" | "Unknown";
            /** Format: int32 */
            deployedRevisionDelta?: number;
            /** Format: date-time */
            deployedDate?: string;
            codeTemplatesChanged?: boolean;
            statistics?: {
                [key: string]: number;
            };
            lifetimeStatistics?: {
                [key: string]: number;
            };
            childStatuses?: components["schemas"]["DashboardStatus"][];
            /** Format: int32 */
            metaDataId?: number;
            queueEnabled?: boolean;
            /** Format: int64 */
            queued?: number;
            waitForPrevious?: boolean;
            /** @enum {string} */
            statusType?: "CHANNEL" | "CHAIN" | "SOURCE_CONNECTOR" | "DESTINATION_CONNECTOR";
            key?: string;
        };
        DashboardChannelInfo: {
            dashboardStatuses?: components["schemas"]["DashboardStatus"][];
            remainingChannelIds?: string[];
            /** Format: int32 */
            deployedChannelCount?: number;
            /** Format: int32 */
            deployedChannelNames?: number;
        };
        CodeTemplateLibrarySaveResult: {
            overrideNeeded?: boolean;
            librariesSuccess?: boolean;
            cause?: {
                stackTrace?: {
                    classLoaderName?: string;
                    moduleName?: string;
                    moduleVersion?: string;
                    methodName?: string;
                    fileName?: string;
                    /** Format: int32 */
                    lineNumber?: number;
                    className?: string;
                    nativeMethod?: boolean;
                }[];
                message?: string;
                suppressed?: {
                    stackTrace?: {
                        classLoaderName?: string;
                        moduleName?: string;
                        moduleVersion?: string;
                        methodName?: string;
                        fileName?: string;
                        /** Format: int32 */
                        lineNumber?: number;
                        className?: string;
                        nativeMethod?: boolean;
                    }[];
                    message?: string;
                    localizedMessage?: string;
                }[];
                localizedMessage?: string;
            };
            libraryResults?: {
                [key: string]: components["schemas"]["LibraryUpdateResult"];
            };
            codeTemplateResults?: {
                [key: string]: components["schemas"]["CodeTemplateUpdateResult"];
            };
        };
        CodeTemplateUpdateResult: {
            success?: boolean;
            /** Format: int32 */
            newRevision?: number;
            /** Format: date-time */
            newLastModified?: string;
            cause?: {
                stackTrace?: {
                    classLoaderName?: string;
                    moduleName?: string;
                    moduleVersion?: string;
                    methodName?: string;
                    fileName?: string;
                    /** Format: int32 */
                    lineNumber?: number;
                    className?: string;
                    nativeMethod?: boolean;
                }[];
                message?: string;
                suppressed?: {
                    stackTrace?: {
                        classLoaderName?: string;
                        moduleName?: string;
                        moduleVersion?: string;
                        methodName?: string;
                        fileName?: string;
                        /** Format: int32 */
                        lineNumber?: number;
                        className?: string;
                        nativeMethod?: boolean;
                    }[];
                    message?: string;
                    localizedMessage?: string;
                }[];
                localizedMessage?: string;
            };
        };
        LibraryUpdateResult: {
            /** Format: int32 */
            newRevision?: number;
            /** Format: date-time */
            newLastModified?: string;
        };
        CodeTemplateSummary: {
            codeTemplateId?: string;
            deleted?: boolean;
            codeTemplate?: components["schemas"]["CodeTemplate"];
        };
        ResourceProperties: {
            pluginPointName?: string;
            type?: string;
            id?: string;
            name?: string;
            description?: string;
            includeWithGlobalScripts?: boolean;
            loadParentFirst?: boolean;
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        LicenseInfo: {
            activated?: boolean;
            online?: boolean;
            /** Format: int64 */
            expirationDate?: number;
            /** Format: int64 */
            warningPeriod?: number;
            /** Format: int64 */
            gracePeriod?: number;
            error?: boolean;
            errorReason?: string;
            warning?: boolean;
            warningReason?: string;
            padlockWarning?: boolean;
            padlock?: boolean;
            expired?: boolean;
            keyNotFound?: boolean;
            unauthorized?: boolean;
            extensions?: string[];
            unpermittedExtensions?: string[];
            downloadedExtensions?: string[];
        };
        PublicServerSettings: {
            environmentName?: string;
            serverName?: string;
            clearGlobalMap?: boolean;
            /** Format: int32 */
            queueBufferSize?: number;
            defaultMetaDataColumns?: components["schemas"]["MetaDataColumn"][];
            defaultAdministratorBackgroundColor?: {
                /** Format: int32 */
                red?: number;
                /** Format: int32 */
                green?: number;
                /** Format: int32 */
                blue?: number;
                /** Format: int32 */
                alpha?: number;
                /** Format: int32 */
                rgb?: number;
                colorSpace?: {
                    /** Format: int32 */
                    type?: number;
                    /** Format: int32 */
                    numComponents?: number;
                    cs_sRGB?: boolean;
                };
                /** Format: int32 */
                transparency?: number;
            };
            smtpHost?: string;
            smtpPort?: string;
            smtpTimeout?: string;
            smtpFrom?: string;
            smtpSecure?: string;
            smtpAuth?: boolean;
            smtpUsername?: string;
            smtpPassword?: string;
            loginNotificationEnabled?: boolean;
            loginNotificationMessage?: string;
            administratorAutoLogoutIntervalEnabled?: boolean;
            /** Format: int32 */
            administratorAutoLogoutIntervalField?: number;
            properties?: {
                [key: string]: string;
            };
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        PasswordRequirements: {
            /** Format: int32 */
            minLength?: number;
            /** Format: int32 */
            minUpper?: number;
            /** Format: int32 */
            minLower?: number;
            /** Format: int32 */
            minNumeric?: number;
            /** Format: int32 */
            minSpecial?: number;
            /** Format: int32 */
            retryLimit?: number;
            /** Format: int32 */
            lockoutPeriod?: number;
            /** Format: int32 */
            expiration?: number;
            /** Format: int32 */
            gracePeriod?: number;
            /** Format: int32 */
            reusePeriod?: number;
            /** Format: int32 */
            reuseLimit?: number;
        };
        EncryptionSettings: {
            encryptExport?: boolean;
            encryptProperties?: boolean;
            encryptionAlgorithm?: string;
            encryptionCharset?: string;
            encryptionFallbackAlgorithm?: string;
            encryptionFallbackCharset?: string;
            /** Format: int32 */
            encryptionKeyLength?: number;
            digestAlgorithm?: string;
            /** Format: int32 */
            digestSaltSize?: number;
            /** Format: int32 */
            digestIterations?: number;
            digestUsePBE?: boolean;
            /** Format: int32 */
            digestKeySize?: number;
            digestFallbackAlgorithm?: string;
            /** Format: int32 */
            digestFallbackSaltSize?: number;
            /** Format: int32 */
            digestFallbackIterations?: number;
            digestFallbackUsePBE?: boolean;
            /** Format: int32 */
            digestFallbackKeySize?: number;
            securityProvider?: string;
            secretKey?: string[];
            properties?: {
                [key: string]: string;
            };
            encryptionBaseAlgorithm?: string;
        };
        DriverInfo: {
            className?: string;
            name?: string;
            template?: string;
            selectLimit?: string;
            alternativeClassNames?: string[];
        };
        ChannelDependency: {
            dependentId?: string;
            dependencyId?: string;
        };
        ConfigurationProperty: {
            value?: string;
            comment?: string;
        };
        ResourcePropertiesList: {
            list?: components["schemas"]["ResourceProperties"][];
        };
        ServerConfiguration: {
            date?: string;
            channelGroups?: components["schemas"]["ChannelGroup"][];
            channels?: components["schemas"]["Channel"][];
            channelTags?: components["schemas"]["ChannelTag"][];
            users?: components["schemas"]["User"][];
            alerts?: components["schemas"]["AlertModel"][];
            codeTemplateLibraries?: components["schemas"]["CodeTemplateLibrary"][];
            serverSettings?: components["schemas"]["ServerSettings"];
            updateSettings?: components["schemas"]["UpdateSettings"];
            globalScripts?: {
                [key: string]: string;
            };
            pluginProperties?: {
                [key: string]: {
                    [key: string]: string;
                };
            };
            resourceProperties?: components["schemas"]["ResourcePropertiesList"];
            channelDependencies?: components["schemas"]["ChannelDependency"][];
            configurationMap?: {
                [key: string]: components["schemas"]["ConfigurationProperty"];
            };
        };
        ServerSettings: {
            environmentName?: string;
            serverName?: string;
            clearGlobalMap?: boolean;
            /** Format: int32 */
            queueBufferSize?: number;
            defaultMetaDataColumns?: components["schemas"]["MetaDataColumn"][];
            defaultAdministratorBackgroundColor?: {
                /** Format: int32 */
                red?: number;
                /** Format: int32 */
                green?: number;
                /** Format: int32 */
                blue?: number;
                /** Format: int32 */
                alpha?: number;
                /** Format: int32 */
                rgb?: number;
                colorSpace?: {
                    /** Format: int32 */
                    type?: number;
                    /** Format: int32 */
                    numComponents?: number;
                    cs_sRGB?: boolean;
                };
                /** Format: int32 */
                transparency?: number;
            };
            smtpHost?: string;
            smtpPort?: string;
            smtpTimeout?: string;
            smtpFrom?: string;
            smtpSecure?: string;
            smtpAuth?: boolean;
            smtpUsername?: string;
            smtpPassword?: string;
            loginNotificationEnabled?: boolean;
            loginNotificationMessage?: string;
            administratorAutoLogoutIntervalEnabled?: boolean;
            /** Format: int32 */
            administratorAutoLogoutIntervalField?: number;
            properties?: {
                [key: string]: string;
            };
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        UpdateSettings: {
            statsEnabled?: boolean;
            /** Format: int64 */
            lastStatsTime?: number;
            properties?: {
                [key: string]: string;
            };
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        User: {
            /** Format: int32 */
            id?: number;
            username?: string;
            email?: string;
            firstName?: string;
            lastName?: string;
            organization?: string;
            description?: string;
            phoneNumber?: string;
            industry?: string;
            /** Format: date-time */
            lastLogin?: string;
            /** Format: date-time */
            gracePeriodStart?: string;
            /** Format: int32 */
            strikeCount?: number;
            /** Format: date-time */
            lastStrikeTime?: string;
            country?: string;
            stateTerritory?: string;
            role?: string;
            userConsent?: boolean;
        };
        DatabaseTask: {
            id?: string;
            /** @enum {string} */
            status?: "Idle" | "Running";
            name?: string;
            description?: string;
            confirmationMessage?: string;
            affectedChannels?: {
                [key: string]: string;
            };
            /** Format: date-time */
            startDateTime?: string;
        };
        ServerEvent: {
            /** Format: int64 */
            dateTime?: number;
            /** Format: int64 */
            nanoTime?: number;
            /** Format: int32 */
            id?: number;
            /** Format: date-time */
            eventTime?: string;
            /** @enum {string} */
            level?: "INFORMATION" | "WARNING" | "ERROR";
            name?: string;
            attributes?: {
                [key: string]: string;
            };
            /** @enum {string} */
            outcome?: "SUCCESS" | "FAILURE";
            /** Format: int32 */
            userId?: number;
            patientId?: string;
            ipAddress?: string;
            serverId?: string;
            channelId?: string;
            channelName?: string;
            messageId?: string;
            channelIdWithMessageId?: string;
        };
        EventFilter: {
            /** Format: int32 */
            maxEventId?: number;
            /** Format: int32 */
            minEventId?: number;
            /** Format: int32 */
            id?: number;
            levels?: ("INFORMATION" | "WARNING" | "ERROR")[];
            /** Format: date-time */
            startDate?: string;
            /** Format: date-time */
            endDate?: string;
            name?: string;
            /** @enum {string} */
            outcome?: "SUCCESS" | "FAILURE";
            /** Format: int32 */
            userId?: number;
            attributeSearch?: string;
            ipAddress?: string;
            serverId?: string;
        };
        ApiProvider: {
            /** @enum {string} */
            type?: "SERVLET_INTERFACE_PACKAGE" | "SERVLET_INTERFACE" | "CORE_PACKAGE" | "SERVER_PACKAGE" | "CORE_CLASS" | "SERVER_CLASS";
            name?: string;
            minVersion?: string;
            maxVersion?: string;
        };
        ExtensionLibrary: {
            path?: string;
            /** @enum {string} */
            type?: "SERVER" | "CLIENT" | "SHARED";
        };
        MetaData: {
            path?: string;
            name?: string;
            author?: string;
            mirthVersion?: string;
            pluginVersion?: string;
            url?: string;
            description?: string;
            apiProviders?: components["schemas"]["ApiProvider"][];
            libraries?: components["schemas"]["ExtensionLibrary"][];
            templateClassName?: string;
            userutilPackages?: string[];
            notify?: boolean;
        };
        ConnectorMetaData: {
            path?: string;
            name?: string;
            author?: string;
            mirthVersion?: string;
            pluginVersion?: string;
            url?: string;
            description?: string;
            apiProviders?: components["schemas"]["ApiProvider"][];
            libraries?: components["schemas"]["ExtensionLibrary"][];
            templateClassName?: string;
            userutilPackages?: string[];
            notify?: boolean;
            serverClassName?: string;
            sharedClassName?: string;
            clientClassName?: string;
            transformers?: string;
            protocol?: string;
            /** @enum {string} */
            type?: "SOURCE" | "DESTINATION";
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        PluginClass: {
            name?: string;
            /** Format: int32 */
            weight?: number;
            conditionClass?: string;
        };
        PluginMetaData: {
            path?: string;
            name?: string;
            author?: string;
            mirthVersion?: string;
            pluginVersion?: string;
            url?: string;
            description?: string;
            apiProviders?: components["schemas"]["ApiProvider"][];
            libraries?: components["schemas"]["ExtensionLibrary"][];
            templateClassName?: string;
            userutilPackages?: string[];
            notify?: boolean;
            serverClasses?: components["schemas"]["PluginClass"][];
            clientClasses?: components["schemas"]["PluginClass"][];
            controllerClasses?: components["schemas"]["PluginClass"][];
            migratorClass?: string;
            sqlScript?: string;
            sqlMapConfigs?: {
                [key: string]: string;
            };
            purgedProperties?: {
                [key: string]: Record<string, never>;
            };
        };
        ConnectorMessage: {
            /** Format: int64 */
            messageId?: number;
            /** Format: int32 */
            metaDataId?: number;
            channelId?: string;
            channelName?: string;
            connectorName?: string;
            serverId?: string;
            /** Format: date-time */
            receivedDate?: string;
            /** @enum {string} */
            status?: "RECEIVED" | "FILTERED" | "TRANSFORMED" | "SENT" | "QUEUED" | "ERROR" | "PENDING";
            raw?: components["schemas"]["MessageContent"];
            processedRaw?: components["schemas"]["MessageContent"];
            transformed?: components["schemas"]["MessageContent"];
            encoded?: components["schemas"]["MessageContent"];
            sent?: components["schemas"]["MessageContent"];
            response?: components["schemas"]["MessageContent"];
            responseTransformed?: components["schemas"]["MessageContent"];
            processedResponse?: components["schemas"]["MessageContent"];
            sourceMapContent?: components["schemas"]["MapContent"];
            connectorMapContent?: components["schemas"]["MapContent"];
            channelMapContent?: components["schemas"]["MapContent"];
            responseMapContent?: components["schemas"]["MapContent"];
            metaDataMap?: {
                [key: string]: Record<string, never>;
            };
            processingErrorContent?: components["schemas"]["ErrorContent"];
            postProcessorErrorContent?: components["schemas"]["ErrorContent"];
            responseErrorContent?: components["schemas"]["ErrorContent"];
            /** Format: int32 */
            errorCode?: number;
            /** Format: int32 */
            sendAttempts?: number;
            /** Format: date-time */
            sendDate?: string;
            /** Format: date-time */
            responseDate?: string;
            /** Format: int32 */
            chainId?: number;
            /** Format: int32 */
            orderId?: number;
            sentProperties?: components["schemas"]["ConnectorProperties"];
            /** Format: int32 */
            queueBucket?: number;
            attemptedFirst?: boolean;
            /** Format: int64 */
            dispatcherId?: number;
            sourceMap?: {
                [key: string]: Record<string, never>;
            };
            responseMap?: {
                [key: string]: Record<string, never>;
            };
            channelMap?: {
                [key: string]: Record<string, never>;
            };
            processingError?: string;
            responseError?: string;
            connectorMap?: {
                [key: string]: Record<string, never>;
            };
            postProcessorError?: string;
            messageContent?: components["schemas"]["MessageContent"];
        };
        ErrorContent: {
            encrypted?: boolean;
            content?: string;
            persisted?: boolean;
        };
        MapContent: {
            encrypted?: boolean;
            content?: Record<string, never>;
            persisted?: boolean;
            map?: {
                [key: string]: Record<string, never>;
            };
        };
        MessageContent: {
            encrypted?: boolean;
            channelId?: string;
            /** Format: int64 */
            messageId?: number;
            /** Format: int32 */
            metaDataId?: number;
            /** @enum {string} */
            contentType?: "Raw" | "Processed Raw" | "Transformed" | "Encoded" | "Sent" | "Response" | "Response Transformed" | "Processed Response" | "Connector Map" | "Channel Map" | "Response Map" | "Processing Error" | "Postprocessor Error" | "Response Error" | "Source Map";
            content?: string;
            dataType?: string;
        };
        ContentSearchElement: {
            /** Format: int32 */
            contentCode?: number;
            searches?: string[];
        };
        MessageFilter: {
            /** Format: int64 */
            maxMessageId?: number;
            /** Format: int64 */
            minMessageId?: number;
            /** Format: int64 */
            originalIdUpper?: number;
            /** Format: int64 */
            originalIdLower?: number;
            /** Format: int64 */
            importIdUpper?: number;
            /** Format: int64 */
            importIdLower?: number;
            /** Format: date-time */
            startDate?: string;
            /** Format: date-time */
            endDate?: string;
            textSearch?: string;
            textSearchRegex?: boolean;
            statuses?: ("RECEIVED" | "FILTERED" | "TRANSFORMED" | "SENT" | "QUEUED" | "ERROR" | "PENDING")[];
            includedMetaDataIds?: number[];
            excludedMetaDataIds?: number[];
            serverId?: string;
            contentSearch?: components["schemas"]["ContentSearchElement"][];
            metaDataSearch?: components["schemas"]["MetaDataSearchElement"][];
            textSearchMetaDataColumns?: string[];
            /** Format: int32 */
            sendAttemptsLower?: number;
            /** Format: int32 */
            sendAttemptsUpper?: number;
            attachment?: boolean;
            error?: boolean;
        };
        MetaDataSearchElement: {
            columnName?: string;
            operator?: string;
            value?: Record<string, never>;
            ignoreCase?: boolean;
        };
        MetaDataSearch: {
            columnName?: string;
            /** @enum {string} */
            operator?: "=" | "!=" | "<" | "<=" | ">" | ">=" | "CONTAINS" | "DOES NOT CONTAIN" | "STARTS WITH" | "DOES NOT START WITH" | "ENDS WITH" | "DOES NOT END WITH";
            value?: string;
        };
        MessageImportResult: {
            /** Format: int32 */
            totalCount?: number;
            /** Format: int32 */
            successCount?: number;
        };
        MessageWriterOptions: {
            /** @enum {string} */
            contentType?: "Raw" | "Processed Raw" | "Transformed" | "Encoded" | "Sent" | "Response" | "Response Transformed" | "Processed Response" | "Connector Map" | "Channel Map" | "Response Map" | "Processing Error" | "Postprocessor Error" | "Response Error" | "Source Map";
            destinationContent?: boolean;
            encrypt?: boolean;
            includeAttachments?: boolean;
            baseFolder?: string;
            rootFolder?: string;
            filePattern?: string;
            archiveFileName?: string;
            archiveFormat?: string;
            compressFormat?: string;
            passwordEnabled?: boolean;
            password?: string;
            /** @enum {string} */
            encryptionType?: "STANDARD" | "AES128" | "AES256";
        };
        RawMessage: {
            overwrite?: boolean;
            imported?: boolean;
            /** Format: int64 */
            originalMessageId?: number;
            rawData?: string;
            rawBytes?: string[];
            destinationMetaDataIds?: number[];
            sourceMap?: {
                [key: string]: Record<string, never>;
            };
            binary?: boolean;
            attachments?: components["schemas"]["Attachment"][];
        };
        Message: {
            /** Format: int64 */
            messageId?: number;
            serverId?: string;
            channelId?: string;
            channelName?: string;
            /** Format: date-time */
            receivedDate?: string;
            processed?: boolean;
            /** Format: int64 */
            originalId?: number;
            /** Format: int64 */
            importId?: number;
            importChannelId?: string;
            attachments?: components["schemas"]["Attachment"][];
            connectorMessages?: {
                [key: string]: components["schemas"]["ConnectorMessage"];
            };
            mergedConnectorMessage?: components["schemas"]["ConnectorMessage"];
        };
        SystemInfo: {
            jvmVersion?: string;
            osName?: string;
            osVersion?: string;
            osArchitecture?: string;
            dbName?: string;
            dbVersion?: string;
        };
        SystemStats: {
            /** Format: date-time */
            timestamp?: string;
            /** Format: double */
            cpuUsagePct?: number;
            /** Format: int64 */
            allocatedMemoryBytes?: number;
            /** Format: int64 */
            freeMemoryBytes?: number;
            /** Format: int64 */
            maxMemoryBytes?: number;
            /** Format: int64 */
            diskFreeBytes?: number;
            /** Format: int64 */
            diskTotalBytes?: number;
        };
        LoginStatus: {
            /** @enum {string} */
            status?: "SUCCESS" | "SUCCESS_GRACE_PERIOD" | "FAIL" | "FAIL_EXPIRED" | "FAIL_LOCKED_OUT" | "FAIL_VERSION_MISMATCH";
            message?: string;
            updatedUsername?: string;
            success?: boolean;
        };
        TrustedCertificate: {
            alias?: string;
            certificate?: string;
            channelsInUse?: string[];
        };
        ConnectionTestResult: {
            success?: boolean;
            message?: string;
            /** Format: int64 */
            timestamp?: number;
            requestedAddress?: string;
            protocol?: string;
            cipherSuite?: string;
            sessionId?: string;
            peerHost?: string;
            /** Format: int32 */
            peerPort?: number;
            sessionValid?: boolean;
            /** Format: int64 */
            sessionCreationTime?: number;
            /** Format: int64 */
            sessionLastAccessedTime?: number;
            supportedProtocols?: string[];
            enabledProtocols?: string[];
            chosenProtocol?: string;
            supportedCipherSuites?: string[];
            enabledCipherSuites?: string[];
            chosenCipherSuite?: string;
            certificates?: {
                type?: string;
                encoded?: string[];
                publicKey?: {
                    encoded?: string[];
                    format?: string;
                    algorithm?: string;
                };
            }[];
            exceptionName?: string;
            exceptionMessage?: string;
            causeName?: string;
            causeMessage?: string;
        };
        LocalCertificate: {
            alias?: string;
            certificate?: string;
            channelsInUse?: string[];
            key?: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    testWrite: {
        parameters: {
            query: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The name of the channel. */
                channelName: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The directory to test writing to. */
        requestBody: {
            content: {
                /** @example /some_folder */
                "text/plain": string;
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
        };
    };
    testWrite_1: {
        parameters: {
            query: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The name of the channel. */
                channelName: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The File Writer properties to use. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["FileDispatcherProperties"];
                "application/json": components["schemas"]["FileDispatcherProperties"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
        };
    };
    testRead: {
        parameters: {
            query: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The name of the channel. */
                channelName: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The File Reader properties to use. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["FileReceiverProperties"];
                "application/json": components["schemas"]["FileReceiverProperties"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
        };
    };
    testConnection: {
        parameters: {
            query: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The name of the channel. */
                channelName: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The HTTP Sender properties to use. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["HttpDispatcherProperties"];
                "application/json": components["schemas"]["HttpDispatcherProperties"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
        };
    };
    getTables: {
        parameters: {
            query: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The name of the channel. */
                channelName: string;
                /** @description The JDBC driver class to use. (ex: org.postgresql.Driver) */
                driver: string;
                /** @description The JDBC connection URL to use. (ex: jdbc:postgresql://localhost:5432/mirthdb) */
                url: string;
                /** @description The username to authenticate with. */
                username?: string;
                /** @description The password to authenticate with. */
                password?: string;
                /** @description If specified, filters by table name. Wildcards (* or %) are allowed. */
                tableNamePattern?: string[];
                /** @description A simple query to use to retrieve database metadata information. */
                selectLimit?: string;
                /** @description Library resource IDs to use, if a custom driver is necessary. */
                resourceId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Table"][];
                    "application/json": components["schemas"]["Table"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Table"][];
                    "application/json": components["schemas"]["Table"][];
                };
            };
        };
    };
    getTemplates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: components["schemas"]["JmsConnectorProperties"];
                    };
                    "application/json": {
                        [key: string]: components["schemas"]["JmsConnectorProperties"];
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: components["schemas"]["JmsConnectorProperties"];
                    };
                    "application/json": {
                        [key: string]: components["schemas"]["JmsConnectorProperties"];
                    };
                };
            };
        };
    };
    getTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The name of the template. */
                templateName: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["JmsConnectorProperties"];
                    "application/json": components["schemas"]["JmsConnectorProperties"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["JmsConnectorProperties"];
                    "application/json": components["schemas"]["JmsConnectorProperties"];
                };
            };
        };
    };
    saveTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The name of the template. */
                templateName: string;
            };
            cookie?: never;
        };
        /** @description The JMS connector properties to save. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["JmsConnectorProperties"];
                "application/json": components["schemas"]["JmsConnectorProperties"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
        };
    };
    deleteTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The name of the template. */
                templateName: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
        };
    };
    sendTestEmail: {
        parameters: {
            query: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The name of the channel. */
                channelName: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The SMTP Sender properties to use. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["SmtpDispatcherProperties"];
                "application/json": components["schemas"]["SmtpDispatcherProperties"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
        };
    };
    testConnection_1: {
        parameters: {
            query: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The name of the channel. */
                channelName: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The TCP Sender properties to use. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["TcpDispatcherProperties"];
                "application/json": components["schemas"]["TcpDispatcherProperties"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
        };
    };
    getDefinition: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    /** @description The ID of the channel. */
                    channelId: string;
                    /** @description The name of the channel. */
                    channelName?: string;
                    /** @description The full URL to the WSDL describing the web service method to be called. */
                    wsdlUrl: string;
                    /** @description Username used to authenticate to the web server. */
                    username?: string;
                    /** @description Password used to authenticate to the web server. */
                    password?: string;
                };
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DefinitionServiceMap"];
                    "application/json": components["schemas"]["DefinitionServiceMap"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DefinitionServiceMap"];
                    "application/json": components["schemas"]["DefinitionServiceMap"];
                };
            };
        };
    };
    isWsdlCached: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    /** @description The ID of the channel. */
                    channelId: string;
                    /** @description The name of the channel. */
                    channelName?: string;
                    /** @description The full URL to the WSDL describing the web service method to be called. */
                    wsdlUrl: string;
                    /** @description Username used to authenticate to the web server. */
                    username?: string;
                    /** @description Password used to authenticate to the web server. */
                    password?: string;
                };
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": boolean;
                    "application/json": boolean;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": boolean;
                    "application/json": boolean;
                };
            };
        };
    };
    getSoapAction: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    /** @description The ID of the channel. */
                    channelId: string;
                    /** @description The name of the channel. */
                    channelName?: string;
                    /** @description The full URL to the WSDL describing the web service method to be called. */
                    wsdlUrl: string;
                    /** @description Username used to authenticate to the web server. */
                    username?: string;
                    /** @description Password used to authenticate to the web server. */
                    password?: string;
                    /** @description The service name for the WSDL defined above. */
                    service: string;
                    /** @description The port / endpoint name for the service defined above. */
                    port: string;
                    /** @description The name of the operation. This is a method provided by the web service. */
                    operation: string;
                };
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /** @example SomeAction */
                    "text/plain": string;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /** @example SomeAction */
                    "text/plain": string;
                };
            };
        };
    };
    generateEnvelope: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    /** @description The ID of the channel. */
                    channelId: string;
                    /** @description The name of the channel. */
                    channelName?: string;
                    /** @description The full URL to the WSDL describing the web service method to be called. */
                    wsdlUrl: string;
                    /** @description Username used to authenticate to the web server. */
                    username?: string;
                    /** @description Password used to authenticate to the web server. */
                    password?: string;
                    /** @description The service name for the WSDL defined above. */
                    service: string;
                    /** @description The port / endpoint name for the service defined above. */
                    port: string;
                    /** @description The name of the operation. This is a method provided by the web service */
                    operation: string;
                    /** @description Whether to include optional fields in the envelope. */
                    buildOptional?: boolean;
                };
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
        };
    };
    testConnection_2: {
        parameters: {
            query: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The name of the channel. */
                channelName?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The Web Service Sender properties to use. These properties can be found in the exported channel's XML file. Copy the data from the opening tag &lt;destinationConnectorProperties&gt; to the closing tag &lt;/wsdlDefinitionMap&gt; (including the tags). Paste over the information below between the opening and closing tags for &lt;com.mirth.connect.connectors.ws.WebServiceDispatcherProperties&gt;. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["WebServiceDispatcherProperties"];
                "application/json": components["schemas"]["WebServiceDispatcherProperties"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
        };
    };
    cacheWsdlFromUrl: {
        parameters: {
            query: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The name of the channel. */
                channelName?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The Web Service Sender properties to use. These properties can be found in the exported channel's XML file. Copy the data from the opening tag &lt;destinationConnectorProperties&gt; to the closing tag &lt;/wsdlDefinitionMap&gt; (including the tags). Paste over the information below between the opening and closing tags for &lt;com.mirth.connect.connectors.ws.WebServiceDispatcherProperties&gt;. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["WebServiceDispatcherProperties"];
                "application/json": components["schemas"]["WebServiceDispatcherProperties"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": Record<string, never>;
                    "application/json": Record<string, never>;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": Record<string, never>;
                    "application/json": Record<string, never>;
                };
            };
        };
    };
    getChannelStates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    getChannelState: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The channel ID to return a dashboard status for. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
        };
    };
    getAllChannelLogs: {
        parameters: {
            query: {
                /** @description The server ID to retrieve logs for. Logs for all servers are retrieved is this parameter is not specified. */
                serverId?: string;
                /** @description Specifies the maximum number of log items to return. */
                fetchSize: number;
                /** @description The last log ID the client retrieved. Only log items with a greater ID will be returned. */
                lastLogId?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionLogItem"][];
                    "application/json": components["schemas"]["ConnectionLogItem"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionLogItem"][];
                    "application/json": components["schemas"]["ConnectionLogItem"][];
                };
            };
        };
    };
    getChannelLog: {
        parameters: {
            query: {
                /** @description The server ID to retrieve logs for. Logs for all servers are retrieved is this parameter is not specified. */
                serverId?: string;
                /** @description Specifies the maximum number of log items to return. */
                fetchSize: number;
                /** @description The last log ID the client retrieved. Only log items with a greater ID will be returned. */
                lastLogId?: number;
            };
            header?: never;
            path: {
                /** @description The channel ID to retrieve logs for. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionLogItem"][];
                    "application/json": components["schemas"]["ConnectionLogItem"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionLogItem"][];
                    "application/json": components["schemas"]["ConnectionLogItem"][];
                };
            };
        };
    };
    getConnectorStateMap: {
        parameters: {
            query?: {
                /** @description The server ID to retrieve connector statuses for. Connector Statuses across all servers are retrieved is this parameter is not specified. */
                serverId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: Record<string, never>[];
                    };
                    "application/json": {
                        [key: string]: Record<string, never>[];
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: Record<string, never>[];
                    };
                    "application/json": {
                        [key: string]: Record<string, never>[];
                    };
                };
            };
        };
    };
    start: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string;
                    "application/json": string;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string;
                    "application/json": string;
                };
            };
        };
    };
    stop: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getStatusMap: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    getLibraries: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the directory resource. */
                resourceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
        };
    };
    getAllMaps: {
        parameters: {
            query?: {
                /** @description The ID of the channel to retrieve global channel map information for. */
                channelId?: string[];
                /** @description If true, the global map will be returned. */
                includeGlobalMap?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: {
                            [key: string]: {
                                [key: string]: string;
                            };
                        };
                    };
                    "application/json": {
                        [key: string]: {
                            [key: string]: {
                                [key: string]: string;
                            };
                        };
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: {
                            [key: string]: {
                                [key: string]: string;
                            };
                        };
                    };
                    "application/json": {
                        [key: string]: {
                            [key: string]: {
                                [key: string]: string;
                            };
                        };
                    };
                };
            };
        };
    };
    getAllMapsPost: {
        parameters: {
            query?: {
                /** @description If true, the global map will be returned. */
                includeGlobalMap?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The ID of the channel to retrieve global channel map information for. */
        requestBody?: {
            content: {
                "application/xml": string[];
                "application/json": string[];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: {
                            [key: string]: {
                                [key: string]: string;
                            };
                        };
                    };
                    "application/json": {
                        [key: string]: {
                            [key: string]: {
                                [key: string]: string;
                            };
                        };
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: {
                            [key: string]: {
                                [key: string]: string;
                            };
                        };
                    };
                    "application/json": {
                        [key: string]: {
                            [key: string]: {
                                [key: string]: string;
                            };
                        };
                    };
                };
            };
        };
    };
    getGlobalChannelMap: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel to retrieve global channel map information for. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "text/plain": {
                        [key: string]: string;
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "text/plain": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    getGlobalMap: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "text/plain": {
                        [key: string]: string;
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "text/plain": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    getServerLogs: {
        parameters: {
            query: {
                /** @description Specifies the maximum number of log items to return. */
                fetchSize: number;
                /** @description The last log ID the client retrieved. Only log items with a greater ID will be returned. */
                lastLogId?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ServerLogItem"][];
                    "application/json": components["schemas"]["ServerLogItem"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ServerLogItem"][];
                    "application/json": components["schemas"]["ServerLogItem"][];
                };
            };
        };
    };
    getAlerts: {
        parameters: {
            query?: {
                /** @description The ID of the alert(s). If absent, all alerts will be returned. */
                alertId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["AlertModel"][];
                    "application/json": components["schemas"]["AlertModel"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["AlertModel"][];
                    "application/json": components["schemas"]["AlertModel"][];
                };
            };
        };
    };
    createAlert: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The alert to create. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["AlertModel"];
                "application/json": components["schemas"]["AlertModel"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getAlertsPost: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The ID of the alert(s). If absent, all alerts will be returned. */
        requestBody?: {
            content: {
                "application/xml": string[];
                "application/json": string[];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["AlertModel"][];
                    "application/json": components["schemas"]["AlertModel"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["AlertModel"][];
                    "application/json": components["schemas"]["AlertModel"][];
                };
            };
        };
    };
    getAlertInfo: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the alert. */
                alertId: string;
            };
            cookie?: never;
        };
        /** @description A map of ChannelHeader objects telling the server the state of the client-side channel cache. */
        requestBody: {
            content: {
                "application/xml": {
                    [key: string]: components["schemas"]["ChannelHeader"];
                };
                "application/json": {
                    [key: string]: components["schemas"]["ChannelHeader"];
                };
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["AlertInfo"];
                    "application/json": components["schemas"]["AlertInfo"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["AlertInfo"];
                    "application/json": components["schemas"]["AlertInfo"];
                };
            };
        };
    };
    getAlertInfo_1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description A map of ChannelHeader objects telling the server the state of the client-side channel cache. */
        requestBody: {
            content: {
                "application/xml": {
                    [key: string]: components["schemas"]["ChannelHeader"];
                };
                "application/json": {
                    [key: string]: components["schemas"]["ChannelHeader"];
                };
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["AlertInfo"];
                    "application/json": components["schemas"]["AlertInfo"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["AlertInfo"];
                    "application/json": components["schemas"]["AlertInfo"];
                };
            };
        };
    };
    getAlertProtocolOptions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: {
                            [key: string]: string;
                        };
                    };
                    "application/json": {
                        [key: string]: {
                            [key: string]: string;
                        };
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: {
                            [key: string]: string;
                        };
                    };
                    "application/json": {
                        [key: string]: {
                            [key: string]: string;
                        };
                    };
                };
            };
        };
    };
    enableAlert: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the alert. */
                alertId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    disableAlert: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the alert. */
                alertId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getAlert: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the alert. */
                alertId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["AlertModel"];
                    "application/json": components["schemas"]["AlertModel"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["AlertModel"];
                    "application/json": components["schemas"]["AlertModel"];
                };
            };
        };
    };
    updateAlert: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the alert. */
                alertId: string;
            };
            cookie?: never;
        };
        /** @description The alert to create. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["AlertModel"];
                "application/json": components["schemas"]["AlertModel"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    removeAlert: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the alert. */
                alertId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getAlertStatusList: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["AlertStatus"][];
                    "application/json": components["schemas"]["AlertStatus"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["AlertStatus"][];
                    "application/json": components["schemas"]["AlertStatus"][];
                };
            };
        };
    };
    getChannelGroupsPost: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The IDs of the channel groups to retrieve. If absent, all groups will be retrieved. */
        requestBody?: {
            content: {
                "application/xml": string[];
                "application/json": string[];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelGroup"][];
                    "application/json": components["schemas"]["ChannelGroup"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelGroup"][];
                    "application/json": components["schemas"]["ChannelGroup"][];
                };
            };
        };
    };
    updateChannelGroups: {
        parameters: {
            query?: {
                /** @description If true, the channel groups will be updated even if different revisions exist on the server. */
                override?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    /** @description The channel group object to update or create. */
                    channelGroups?: components["schemas"]["ChannelGroup"][];
                    /** @description All channel group IDs known to be removed. */
                    removedChannelGroupIds?: string[];
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": boolean;
                    "text/plain": boolean;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": boolean;
                    "text/plain": boolean;
                };
            };
        };
    };
    getChannelGroups: {
        parameters: {
            query?: {
                /** @description The IDs of the channel groups to retrieve. If absent, all groups will be retrieved. */
                channelGroupId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelGroup"][];
                    "application/json": components["schemas"]["ChannelGroup"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelGroup"][];
                    "application/json": components["schemas"]["ChannelGroup"][];
                };
            };
        };
    };
    getChannel: {
        parameters: {
            query?: {
                /** @description If true, code template libraries will be included in the channel. */
                includeCodeTemplateLibraries?: boolean;
            };
            header?: never;
            path: {
                /** @description The ID of the channel to retrieve. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Channel"];
                    "application/json": components["schemas"]["Channel"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Channel"];
                    "application/json": components["schemas"]["Channel"];
                };
            };
        };
    };
    updateChannel: {
        parameters: {
            query?: {
                /** @description If true, the channel will be updated even if a different revision exists on the server. */
                override?: boolean;
                /** @description Date and time starting to edit this channel. Example: 1985-10-26T09:00:00.000-0700 */
                startEdit?: string;
            };
            header?: never;
            path: {
                /** @description The ID of the channel to update. */
                channelId: string;
            };
            cookie?: never;
        };
        /** @description The Channel object to update with. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["Channel"];
                "application/json": components["schemas"]["Channel"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": boolean;
                    "text/plain": boolean;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": boolean;
                    "text/plain": boolean;
                };
            };
        };
    };
    removeChannel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel to remove. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getChannelsPost: {
        parameters: {
            query?: {
                /** @description If true, only channels with polling source connectors will be returned. */
                pollingOnly?: boolean;
                /** @description If true, code template libraries will be included in the channel. */
                includeCodeTemplateLibraries?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The IDs of the channels to retrieve. If absent, all channels will be retrieved. */
        requestBody?: {
            content: {
                "application/xml": string[];
                "application/json": string[];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Channel"][];
                    "application/json": components["schemas"]["Channel"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Channel"][];
                    "application/json": components["schemas"]["Channel"][];
                };
            };
        };
    };
    getChannelIdsAndNames: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    getChannelPortsInUse: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Ports"][];
                    "application/json": components["schemas"]["Ports"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Ports"][];
                    "application/json": components["schemas"]["Ports"][];
                };
            };
        };
    };
    removeChannelsPost: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The IDs of the channels to remove. */
        requestBody: {
            content: {
                "application/xml": string[];
                "application/json": string[];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getChannelSummary: {
        parameters: {
            query: {
                /** @description If true, summaries will only be returned for channels in the map's entry set. */
                ignoreNewChannels: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description A map of ChannelHeader objects telling the server the state of the client-side channel cache. */
        requestBody: {
            content: {
                "application/xml": {
                    [key: string]: components["schemas"]["ChannelHeader"];
                };
                "application/json": {
                    [key: string]: components["schemas"]["ChannelHeader"];
                };
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelSummary"][];
                    "application/json": components["schemas"]["ChannelSummary"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelSummary"][];
                    "application/json": components["schemas"]["ChannelSummary"][];
                };
            };
        };
    };
    setChannelEnabled: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    channelId?: string[];
                    enabled: boolean;
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    setChannelEnabled_1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The enabled flag (true/false) to set. */
                enabled: boolean;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    setChannelInitialState: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The initial state of the channel. */
                initialState: "STARTED" | "PAUSED" | "STOPPED";
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    setChannelInitialState_1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    channelId?: string[];
                    /** @enum {string} */
                    initialState: "STARTED" | "PAUSED" | "STOPPED";
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getConnectorNames: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    getChannels: {
        parameters: {
            query?: {
                /** @description The IDs of the channels to retrieve. If absent, all channels will be retrieved. */
                channelId?: string[];
                /** @description If true, only channels with polling source connectors will be returned. */
                pollingOnly?: boolean;
                /** @description If true, code template libraries will be included in the channel. */
                includeCodeTemplateLibraries?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Channel"][];
                    "application/json": components["schemas"]["Channel"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Channel"][];
                    "application/json": components["schemas"]["Channel"][];
                };
            };
        };
    };
    createChannel: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The Channel object to create. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["Channel"];
                "application/json": components["schemas"]["Channel"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": boolean;
                    "text/plain": boolean;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": boolean;
                    "text/plain": boolean;
                };
            };
        };
    };
    removeChannels: {
        parameters: {
            query: {
                /** @description The IDs of the channels to remove. */
                channelId: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getMetaDataColumns: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["MetaDataColumn"][];
                    "application/json": components["schemas"]["MetaDataColumn"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["MetaDataColumn"][];
                    "application/json": components["schemas"]["MetaDataColumn"][];
                };
            };
        };
    };
    getStatisticsPost: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    channelIds?: string[];
                    includeUndeployed?: boolean;
                    includeMetadataIds?: number[];
                    excludeMetadataIds?: number[];
                    aggregateStats?: boolean;
                };
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelStatistics"][];
                    "application/json": components["schemas"]["ChannelStatistics"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelStatistics"][];
                    "application/json": components["schemas"]["ChannelStatistics"][];
                };
            };
        };
    };
    clearAllStatistics: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getStatistics: {
        parameters: {
            query?: {
                /** @description The IDs of the channels to retrieve. If absent, all channels will be retrieved. */
                channelId?: string[];
                /** @description If true, statistics for undeployed channels will also be included. */
                includeUndeployed?: boolean;
                /** @description The ids of connectors to include. Cannot include and exclude connectors. */
                includeMetadataId?: number[];
                /** @description The ids of connectors to exclude. Cannot include and exclude connectors. */
                excludeMetadataId?: number[];
                /** @description If true, statistics will be aggregated into one result */
                aggregateStats?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelStatistics"][];
                    "application/json": components["schemas"]["ChannelStatistics"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelStatistics"][];
                    "application/json": components["schemas"]["ChannelStatistics"][];
                };
            };
        };
    };
    getStatistics_1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel to retrieve statistics for. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelStatistics"];
                    "application/json": components["schemas"]["ChannelStatistics"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelStatistics"];
                    "application/json": components["schemas"]["ChannelStatistics"];
                };
            };
        };
    };
    clearStatistics: {
        parameters: {
            query?: {
                /** @description If true, received stats will be cleared. */
                received?: boolean;
                /** @description If true, filtered stats will be cleared. */
                filtered?: boolean;
                /** @description If true, sent stats will be cleared. */
                sent?: boolean;
                /** @description If true, error stats will be cleared. */
                error?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Channel IDs mapped to lists of metaDataIds (connectors). If the metaDataId list is null, then all statistics for the channel will be cleared. */
        requestBody: {
            content: {
                "application/xml": {
                    [key: string]: number[];
                };
                "application/json": {
                    [key: string]: number[];
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getChannelStatusListPost: {
        parameters: {
            query?: {
                /** @description The filter string to limit dashboard statuses with. */
                filter?: string;
                /** @description If true, statuses for undeployed channels will also be included. */
                includeUndeployed?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The channel IDs to return dashboard statuses for. If absent, all statuses will be returned. */
        requestBody?: {
            content: {
                "application/xml": string[];
                "application/json": string[];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DashboardStatus"][];
                    "application/json": components["schemas"]["DashboardStatus"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DashboardStatus"][];
                    "application/json": components["schemas"]["DashboardStatus"][];
                };
            };
        };
    };
    getDashboardChannelInfo: {
        parameters: {
            query: {
                /** @description Specifies the maximum number of statuses to return. */
                fetchSize: number;
                /** @description The filter string to limit dashboard statuses with. */
                filter?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DashboardChannelInfo"];
                    "application/json": components["schemas"]["DashboardChannelInfo"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DashboardChannelInfo"];
                    "application/json": components["schemas"]["DashboardChannelInfo"];
                };
            };
        };
    };
    startConnectors: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description A map of channel and metadata IDs to start connectors for. */
        requestBody: {
            content: {
                "application/xml": {
                    [key: string]: number[];
                };
                "application/json": {
                    [key: string]: number[];
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    startChannel: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path: {
                /** @description The channel ID to start. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    stopChannel: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path: {
                /** @description The channel ID to stop. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    haltChannel: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path: {
                /** @description The channel ID to halt. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    pauseChannel: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path: {
                /** @description The channel ID to pause. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    resumeChannel: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path: {
                /** @description The channel ID to resume. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    stopConnectors: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description A map of channel and metadata IDs to stop connectors for. */
        requestBody: {
            content: {
                "application/xml": {
                    [key: string]: number[];
                };
                "application/json": {
                    [key: string]: number[];
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    startChannels: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    channelId: string[];
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    stopChannels: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    channelId: string[];
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    pauseChannels: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    channelId: string[];
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    resumeChannels: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    channelId: string[];
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    startConnector: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path: {
                /** @description The channel ID to start a connector for. */
                channelId: string;
                /** @description The connector metadata ID to start. */
                metaDataId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    stopConnector: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path: {
                /** @description The channel ID to stop a connector for. */
                channelId: string;
                /** @description The connector metadata ID to stop. */
                metaDataId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    haltChannels: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    channelId: string[];
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getChannelStatusList: {
        parameters: {
            query?: {
                /** @description The channel IDs to return dashboard statuses for. If absent, all statuses will be returned. */
                channelId?: string[];
                /** @description The filter string to limit dashboard statuses with. */
                filter?: string;
                /** @description If true, statuses for undeployed channels will also be included. */
                includeUndeployed?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DashboardStatus"][];
                    "application/json": components["schemas"]["DashboardStatus"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DashboardStatus"][];
                    "application/json": components["schemas"]["DashboardStatus"][];
                };
            };
        };
    };
    getChannelStatus: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The channel ID to return a dashboard status for. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DashboardStatus"];
                    "application/json": components["schemas"]["DashboardStatus"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DashboardStatus"];
                    "application/json": components["schemas"]["DashboardStatus"];
                };
            };
        };
    };
    getCodeTemplateLibrariesPost: {
        parameters: {
            query?: {
                /** @description If true, full code templates will be included inside each library. */
                includeCodeTemplates?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The ID of the library(s) to retrieve. */
        requestBody?: {
            content: {
                "application/xml": string[];
                "application/json": string[];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplateLibrary"][];
                    "application/json": components["schemas"]["CodeTemplateLibrary"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplateLibrary"][];
                    "application/json": components["schemas"]["CodeTemplateLibrary"][];
                };
            };
        };
    };
    getCodeTemplateLibraries: {
        parameters: {
            query?: {
                /** @description The ID of the library(s) to retrieve. */
                libraryId?: string[];
                /** @description If true, full code templates will be included inside each library. */
                includeCodeTemplates?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplateLibrary"][];
                    "application/json": components["schemas"]["CodeTemplateLibrary"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplateLibrary"][];
                    "application/json": components["schemas"]["CodeTemplateLibrary"][];
                };
            };
        };
    };
    updateCodeTemplateLibraries: {
        parameters: {
            query?: {
                /** @description If true, the code template library will be updated even if a different revision exists on the server. */
                override?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The list of code template libraries to replace with. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["CodeTemplateLibrary"][];
                "application/json": components["schemas"]["CodeTemplateLibrary"][];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": boolean;
                    "application/json": boolean;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": boolean;
                    "application/json": boolean;
                };
            };
        };
    };
    getCodeTemplateLibrary: {
        parameters: {
            query?: {
                /** @description If true, full code templates will be included inside each library. */
                includeCodeTemplates?: boolean;
            };
            header?: never;
            path: {
                /** @description The ID of the library to retrieve. */
                libraryId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplateLibrary"];
                    "application/json": components["schemas"]["CodeTemplateLibrary"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplateLibrary"];
                    "application/json": components["schemas"]["CodeTemplateLibrary"];
                };
            };
        };
    };
    getCodeTemplatesPost: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The ID of the code template(s) to retrieve. */
        requestBody?: {
            content: {
                "application/xml": string[];
                "application/json": string[];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplate"][];
                    "application/json": components["schemas"]["CodeTemplate"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplate"][];
                    "application/json": components["schemas"]["CodeTemplate"][];
                };
            };
        };
    };
    getCodeTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the code template to retrieve. */
                codeTemplateId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplate"];
                    "application/json": components["schemas"]["CodeTemplate"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplate"];
                    "application/json": components["schemas"]["CodeTemplate"];
                };
            };
        };
    };
    updateCodeTemplate: {
        parameters: {
            query?: {
                /** @description If true, the code template will be updated even if a different revision exists on the server. */
                override?: boolean;
            };
            header?: never;
            path: {
                /** @description The ID of the code template. */
                codeTemplateId: string;
            };
            cookie?: never;
        };
        /** @description The CodeTemplate object to update with. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["CodeTemplate"];
                "application/json": components["schemas"]["CodeTemplate"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": boolean;
                    "application/json": boolean;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": boolean;
                    "application/json": boolean;
                };
            };
        };
    };
    removeCodeTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the code template. */
                codeTemplateId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    updateLibrariesAndTemplates: {
        parameters: {
            query?: {
                /** @description If true, the libraries and code templates will be updated even if different revisions exist on the server. */
                override?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    /** @description The set of code template libraries to replace with. */
                    libraries?: components["schemas"]["CodeTemplateLibrary"][];
                    /** @description All library IDs known to be removed. */
                    removedLibraryIds?: string[];
                    /** @description The set of code templates to update. */
                    updatedCodeTemplates?: components["schemas"]["CodeTemplate"][];
                    /** @description All code template IDs known to be removed. */
                    removedCodeTemplateIds?: string[];
                };
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplateLibrarySaveResult"];
                    "application/json": components["schemas"]["CodeTemplateLibrarySaveResult"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplateLibrarySaveResult"];
                    "application/json": components["schemas"]["CodeTemplateLibrarySaveResult"];
                };
            };
        };
    };
    getCodeTemplateSummary: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description A map of revisions telling the server the state of the client-side code template cache. */
        requestBody: {
            content: {
                "application/xml": {
                    [key: string]: number;
                };
                "application/json": {
                    [key: string]: number;
                };
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplateSummary"][];
                    "application/json": components["schemas"]["CodeTemplateSummary"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplateSummary"][];
                    "application/json": components["schemas"]["CodeTemplateSummary"][];
                };
            };
        };
    };
    getCodeTemplates: {
        parameters: {
            query?: {
                /** @description The ID of the code template(s) to retrieve. */
                codeTemplateId?: string[];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplate"][];
                    "application/json": components["schemas"]["CodeTemplate"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["CodeTemplate"][];
                    "application/json": components["schemas"]["CodeTemplate"][];
                };
            };
        };
    };
    getProperty: {
        parameters: {
            query: {
                /** @description The property group. */
                group: string;
                /** @description The name of the property. */
                name: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
        };
    };
    getResources: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ResourceProperties"][];
                    "application/json": components["schemas"]["ResourceProperties"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ResourceProperties"][];
                    "application/json": components["schemas"]["ResourceProperties"][];
                };
            };
        };
    };
    setResources: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The new list of resource properties to update with. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["ResourceProperties"][];
                "application/json": components["schemas"]["ResourceProperties"][];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getVersion: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
        };
    };
    getProtocolsAndCipherSuites: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string[];
                    };
                    "application/json": {
                        [key: string]: string[];
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string[];
                    };
                    "application/json": {
                        [key: string]: string[];
                    };
                };
            };
        };
    };
    getJVMName: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
        };
    };
    getAbout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: Record<string, never>;
                    };
                    "application/json": {
                        [key: string]: Record<string, never>;
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: Record<string, never>;
                    };
                    "application/json": {
                        [key: string]: Record<string, never>;
                    };
                };
            };
        };
    };
    getLicenseInfo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["LicenseInfo"];
                    "application/json": components["schemas"]["LicenseInfo"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["LicenseInfo"];
                    "application/json": components["schemas"]["LicenseInfo"];
                };
            };
        };
    };
    getGuid: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
        };
    };
    getServerTime: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string;
                    "application/json": string;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string;
                    "application/json": string;
                };
            };
        };
    };
    getBuildDate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
        };
    };
    sendTestEmail_1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description Contains all properties needed to send the e-mail. Properties include: port, encryption, host, timeout, authentication, username, password, toAddress, fromAddress */
        requestBody: {
            content: {
                "application/xml": string;
                "application/json": string;
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResponse"];
                    "application/json": components["schemas"]["ConnectionTestResponse"];
                };
            };
        };
    };
    getRhinoLanguageVersion: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
        };
    };
    getAvailableCharsetEncodings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
        };
    };
    getPublicServerSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["PublicServerSettings"];
                    "application/json": components["schemas"]["PublicServerSettings"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["PublicServerSettings"];
                    "application/json": components["schemas"]["PublicServerSettings"];
                };
            };
        };
    };
    getPasswordRequirements: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["PasswordRequirements"];
                    "application/json": components["schemas"]["PasswordRequirements"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["PasswordRequirements"];
                    "application/json": components["schemas"]["PasswordRequirements"];
                };
            };
        };
    };
    getEncryptionSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["EncryptionSettings"];
                    "application/json": components["schemas"]["EncryptionSettings"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["EncryptionSettings"];
                    "application/json": components["schemas"]["EncryptionSettings"];
                };
            };
        };
    };
    getServerTimezone: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
        };
    };
    getDatabaseDrivers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DriverInfo"][];
                    "application/json": components["schemas"]["DriverInfo"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DriverInfo"][];
                    "application/json": components["schemas"]["DriverInfo"][];
                };
            };
        };
    };
    setDatabaseDrivers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The new list of database drivers to update. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["DriverInfo"][];
                "application/json": components["schemas"]["DriverInfo"][];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getServerConfiguration: {
        parameters: {
            query?: {
                /** @description The initial state to set all channels in the configuration to. */
                initialState?: "STARTED" | "PAUSED" | "STOPPED";
                /** @description If true, and the initialState parameter is set, only channels with polling source connectors will have their initial states overwritten in the returned server configuration. */
                pollingOnly?: boolean;
                /** @description If true, all alerts returned in the server configuration will be disabled. */
                disableAlerts?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ServerConfiguration"];
                    "application/json": components["schemas"]["ServerConfiguration"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ServerConfiguration"];
                    "application/json": components["schemas"]["ServerConfiguration"];
                };
            };
        };
    };
    setServerConfiguration: {
        parameters: {
            query?: {
                /** @description If true, all enabled channels will be deployed after the configuration is restored. */
                deploy?: boolean;
                /** @description If true, overwrite the Configuration Map */
                overwriteConfigMap?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The ServerConfiguration object containing all channels, users, alerts, and properties to update. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["ServerConfiguration"];
                "application/json": components["schemas"]["ServerConfiguration"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getChannelMetadata: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: components["schemas"]["ChannelMetadata"];
                    };
                    "application/json": {
                        [key: string]: components["schemas"]["ChannelMetadata"];
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: components["schemas"]["ChannelMetadata"];
                    };
                    "application/json": {
                        [key: string]: components["schemas"]["ChannelMetadata"];
                    };
                };
            };
        };
    };
    setChannelMetadata: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The map of channel metadata to set. */
        requestBody: {
            content: {
                "application/xml": {
                    [key: string]: components["schemas"]["ChannelMetadata"];
                };
                "application/json": {
                    [key: string]: components["schemas"]["ChannelMetadata"];
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    reloadResource: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The unique ID of the resource to reload. */
                resourceId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getServerSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ServerSettings"];
                    "application/json": components["schemas"]["ServerSettings"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ServerSettings"];
                    "application/json": components["schemas"]["ServerSettings"];
                };
            };
        };
    };
    setServerSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The ServerSettings object containing all of the settings to update. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["ServerSettings"];
                "application/json": components["schemas"]["ServerSettings"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getConfigurationMap: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: components["schemas"]["ConfigurationProperty"];
                    };
                    "application/json": {
                        [key: string]: components["schemas"]["ConfigurationProperty"];
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: components["schemas"]["ConfigurationProperty"];
                    };
                    "application/json": {
                        [key: string]: components["schemas"]["ConfigurationProperty"];
                    };
                };
            };
        };
    };
    setConfigurationMap: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The new configuration map to update with. */
        requestBody: {
            content: {
                "application/xml": {
                    [key: string]: components["schemas"]["ConfigurationProperty"];
                };
                "application/json": {
                    [key: string]: components["schemas"]["ConfigurationProperty"];
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getChannelTags: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelTag"][];
                    "application/json": components["schemas"]["ChannelTag"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelTag"][];
                    "application/json": components["schemas"]["ChannelTag"][];
                };
            };
        };
    };
    setChannelTags: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The channel tags to set. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["ChannelTag"][];
                "application/json": components["schemas"]["ChannelTag"][];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getUpdateSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["UpdateSettings"];
                    "application/json": components["schemas"]["UpdateSettings"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["UpdateSettings"];
                    "application/json": components["schemas"]["UpdateSettings"];
                };
            };
        };
    };
    setUpdateSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The UpdateSettings object containing all of the settings to update. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["UpdateSettings"];
                "application/json": components["schemas"]["UpdateSettings"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getGlobalScripts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    setGlobalScripts: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The map of global scripts to update with. Script keys: Deploy, Undeploy, Preprocessor, Postprocessor */
        requestBody: {
            content: {
                "application/xml": {
                    [key: string]: string;
                };
                "application/json": {
                    [key: string]: string;
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getChannelDependencies: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelDependency"][];
                    "application/json": components["schemas"]["ChannelDependency"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ChannelDependency"][];
                    "application/json": components["schemas"]["ChannelDependency"][];
                };
            };
        };
    };
    setChannelDependencies: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The channel dependencies to set. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["ChannelDependency"][];
                "application/json": components["schemas"]["ChannelDependency"][];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getServerId: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
        };
    };
    getStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
        };
    };
    getDatabaseTasks: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: components["schemas"]["DatabaseTask"];
                    };
                    "application/json": {
                        [key: string]: components["schemas"]["DatabaseTask"];
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: components["schemas"]["DatabaseTask"];
                    };
                    "application/json": {
                        [key: string]: components["schemas"]["DatabaseTask"];
                    };
                };
            };
        };
    };
    getDatabaseTask: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the database task. */
                databaseTaskId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DatabaseTask"];
                    "application/json": components["schemas"]["DatabaseTask"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DatabaseTask"];
                    "application/json": components["schemas"]["DatabaseTask"];
                };
            };
        };
    };
    runDatabaseTask: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the database task. */
                databaseTaskId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /** @example Table SOME_TABLE successfully dropped. */
                    "text/plain": string;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /** @example Table SOME_TABLE successfully dropped. */
                    "text/plain": string;
                };
            };
        };
    };
    cancelDatabaseTask: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the database task. */
                databaseTaskId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    undeployChannel: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path: {
                /** @description The ID of the channel to undeploy. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    deployChannel: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
                /**
                 * @description If present, the channel will deploy in debug mode and use these options. The input should be a comma-separated list of 't' and 'f' values that indicate whether to debug Deploy/Undeploy/Preprocessor/Postprocessor scripts, Attachment/Batch scripts, Source Connectors scripts, Source Filter/Transformer scripts, Destination Filter/Transformer scripts, Destination Connector scripts, and Destination Response Transformer scripts, in that order. Example: "f,f,f,f,f,f,f")
                 * @example f,f,f,f,f,f,f
                 */
                debugOptions?: string;
            };
            header?: never;
            path: {
                /** @description The ID of the channel to deploy. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    deployChannels: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The ID of the channel(s) to deploy. If absent, all channels will be deployed. */
        requestBody?: {
            content: {
                "application/xml": string[];
                "application/json": string[];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    undeployChannels: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The IDs of the channels to retrieve. If absent, all channels will be retrieved. */
        requestBody?: {
            content: {
                "application/xml": string[];
                "application/json": string[];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    redeployAllChannels: {
        parameters: {
            query?: {
                /** @description If true, an error response code and the exception will be returned. */
                returnErrors?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getEvents: {
        parameters: {
            query?: {
                /** @description The maximum event ID to query. */
                maxEventId?: number;
                /** @description The minimum event ID to query. */
                minEventId?: number;
                /** @description The type of events to query. */
                level?: ("INFORMATION" | "WARNING" | "ERROR")[];
                /** @description The earliest event date to query by. Example: 1985-10-26T09:00:00.000-0700 */
                startDate?: string;
                /** @description The latest event date to query by. Example: 2015-10-21T07:28:00.000-0700 */
                endDate?: string;
                /** @description Searches the event name for this string. */
                name?: string;
                /** @description Searches on whether the event outcome was successful or not. */
                outcome?: "SUCCESS" | "FAILURE";
                /** @description The user ID to query events by. */
                userId?: number;
                /** @description Searches the attributes for this string. */
                attributeSearch?: string;
                /** @description The IP address that originated the event. */
                ipAddress?: string;
                /** @description The ID of the server that the event was created from. */
                serverId?: string;
                /** @description Used for pagination, determines where to start in the search results. */
                offset?: number;
                /** @description Used for pagination, determines the maximum number of results to return. */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ServerEvent"][];
                    "application/json": components["schemas"]["ServerEvent"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ServerEvent"][];
                    "application/json": components["schemas"]["ServerEvent"][];
                };
            };
        };
    };
    getEvents_1: {
        parameters: {
            query?: {
                /** @description Used for pagination, determines where to start in the search results. */
                offset?: number;
                /** @description Used for pagination, determines the maximum number of results to return. */
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The EventFilter object to use to query events by. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["EventFilter"];
                "application/json": components["schemas"]["EventFilter"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ServerEvent"][];
                    "application/json": components["schemas"]["ServerEvent"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ServerEvent"][];
                    "application/json": components["schemas"]["ServerEvent"][];
                };
            };
        };
    };
    getEventCount: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The EventFilter object to use to query events by. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["EventFilter"];
                "application/json": components["schemas"]["EventFilter"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": number;
                    "text/plain": number;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": number;
                    "text/plain": number;
                };
            };
        };
    };
    getEventCount_1: {
        parameters: {
            query?: {
                /** @description The maximum event ID to query. */
                maxEventId?: number;
                /** @description The minimum event ID to query. */
                minEventId?: number;
                /** @description The type of events to query. */
                level?: ("INFORMATION" | "WARNING" | "ERROR")[];
                /** @description The earliest event date to query by. Example: 1985-10-26T09:00:00.000-0700 */
                startDate?: string;
                /** @description The latest event date to query by. Example: 2015-10-21T07:28:00.000-0700 */
                endDate?: string;
                /** @description Searches the event name for this string. */
                name?: string;
                /** @description Searches on whether the event outcome was successful or not. */
                outcome?: "SUCCESS" | "FAILURE";
                /** @description The user ID to query events by. */
                userId?: number;
                /** @description Searches the attributes for this string. */
                attributeSearch?: string;
                /** @description The IP address that originated the event. */
                ipAddress?: string;
                /** @description The ID of the server that the event was created from. */
                serverId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": number;
                    "text/plain": number;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": number;
                    "text/plain": number;
                };
            };
        };
    };
    exportAllEvents: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
        };
    };
    getMaxEventId: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": number;
                    "text/plain": number;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": number;
                    "text/plain": number;
                };
            };
        };
    };
    getEvent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the event. */
                eventId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ServerEvent"];
                    "application/json": components["schemas"]["ServerEvent"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ServerEvent"];
                    "application/json": components["schemas"]["ServerEvent"];
                };
            };
        };
    };
    installExtension: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    /**
                     * Format: binary
                     * @description The extension file to upload.
                     */
                    file?: string;
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    uninstallExtension: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The path attribute of the extension to uninstall. */
        requestBody: {
            content: {
                "application/xml": string;
                "application/json": string;
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getExtensionMetaData: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The name of the extension to retrieve. */
                extensionName: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["MetaData"];
                    "application/json": components["schemas"]["MetaData"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["MetaData"];
                    "application/json": components["schemas"]["MetaData"];
                };
            };
        };
    };
    isExtensionEnabled: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The name of the extension to retrieve. */
                extensionName: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": boolean;
                    "application/json": boolean;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": boolean;
                    "application/json": boolean;
                };
            };
        };
    };
    setExtensionEnabled: {
        parameters: {
            query: {
                /** @description The new enabled status to set. */
                enabled: boolean;
            };
            header?: never;
            path: {
                /** @description The name of the extension to retrieve. */
                extensionName: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getDisabledExtensions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
        };
    };
    getConnectorMetaData: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: components["schemas"]["ConnectorMetaData"];
                    };
                    "application/json": {
                        [key: string]: components["schemas"]["ConnectorMetaData"];
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: components["schemas"]["ConnectorMetaData"];
                    };
                    "application/json": {
                        [key: string]: components["schemas"]["ConnectorMetaData"];
                    };
                };
            };
        };
    };
    getPluginMetaData: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: components["schemas"]["PluginMetaData"];
                    };
                    "application/json": {
                        [key: string]: components["schemas"]["PluginMetaData"];
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: components["schemas"]["PluginMetaData"];
                    };
                    "application/json": {
                        [key: string]: components["schemas"]["PluginMetaData"];
                    };
                };
            };
        };
    };
    getPluginProperties: {
        parameters: {
            query?: {
                /** @description The set of properties to retrieve. */
                propertyKeys?: string[];
            };
            header?: never;
            path: {
                /** @description The name of the extension to retrieve. */
                extensionName: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": {
                        [key: string]: string;
                    };
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    setPluginProperties: {
        parameters: {
            query?: {
                /** @description Merge or replace properties. Defaults to replace. */
                mergeProperties?: boolean;
            };
            header?: never;
            path: {
                extensionName: string;
            };
            cookie?: never;
        };
        /** @description description */
        requestBody?: {
            content: {
                "application/xml": string;
                "application/json": string;
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getAttachmentsByMessageId: {
        parameters: {
            query?: {
                /** @description If false, only the attachment ID and type will be returned. */
                includeContent?: boolean;
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The ID of the message. */
                messageId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Attachment"][];
                    "application/json": components["schemas"]["Attachment"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Attachment"][];
                    "application/json": components["schemas"]["Attachment"][];
                };
            };
        };
    };
    getDICOMMessage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The ID of the message. */
                messageId: number;
            };
            cookie?: never;
        };
        /** @description The ConnectorMessage to retrieve DICOM data for. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["ConnectorMessage"];
                "application/json": components["schemas"]["ConnectorMessage"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
        };
    };
    getMessageCount: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        /** @description The MessageFilter object to use to query messages by. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["MessageFilter"];
                "application/json": components["schemas"]["MessageFilter"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
        };
    };
    getMessageCount_1: {
        parameters: {
            query?: {
                /** @description The minimum message ID to query. */
                minMessageId?: number;
                /** @description The maximum message ID to query. */
                maxMessageId?: number;
                /** @description The minimum original message ID to query. Messages that have been reprocessed will retain their original message ID. */
                minOriginalId?: number;
                /** @description The maximum original message ID to query. Messages that have been reprocessed will retain their original message ID. */
                maxOriginalId?: number;
                /** @description The minimum import message ID to query. Messages that have been imported will retain their original message ID under this value. */
                minImportId?: number;
                /** @description The maximum import message ID to query. Messages that have been imported will retain their original message ID under this value. */
                maxImportId?: number;
                /** @description The earliest original received date to query by. Example: 1985-10-26T09:00:00.000-0700 */
                startDate?: string;
                /** @description The latest original received date to query by. Example: 2015-10-21T07:28:00.000-0700 */
                endDate?: string;
                /** @description Searches all message content for this string. This process could take a long time depending on the amount of message content currently stored. Any message content that was encrypted by this channel will not be searchable. */
                textSearch?: string;
                /** @description If true, text search input will be considered a regular expression pattern to be matched. Only supported by PostgreSQL, MySQL and Oracle databases. */
                textSearchRegex?: boolean;
                /** @description Determines which message statuses to query by. */
                status?: ("RECEIVED" | "FILTERED" | "TRANSFORMED" | "SENT" | "QUEUED" | "ERROR" | "PENDING")[];
                /** @description If present, only connector metadata IDs in this list will be queried. */
                includedMetaDataId?: number[];
                /** @description If present, connector metadata IDs in this list will not be queried. */
                excludedMetaDataId?: number[];
                /** @description The server ID associated with messages. */
                serverId?: string;
                /** @description Searches the raw content of messages. */
                rawContentSearch?: string[];
                /** @description Searches the processed raw content of messages. */
                processedRawContentSearch?: string[];
                /** @description Searches the transformed content of messages. */
                transformedContentSearch?: string[];
                /** @description Searches the encoded content of messages. */
                encodedContentSearch?: string[];
                /** @description Searches the sent content of messages. */
                sentContentSearch?: string[];
                /** @description Searches the response content of messages. */
                responseContentSearch?: string[];
                /** @description Searches the response transformed content of messages. */
                responseTransformedContentSearch?: string[];
                /** @description Searches the processed response content of messages. */
                processedResponseContentSearch?: string[];
                /** @description Searches the connector map content of messages. */
                connectorMapContentSearch?: string[];
                /** @description Searches the channel map content of messages. */
                channelMapContentSearch?: string[];
                /** @description Searches the source map content of messages. */
                sourceMapContentSearch?: string[];
                /** @description Searches the response map content of messages. */
                responseMapContentSearch?: string[];
                /** @description Searches the processing error content of messages. */
                processingErrorContentSearch?: string[];
                /** @description Searches the postprocessor error content of messages. */
                postprocessorErrorContentSearch?: string[];
                /** @description Searches the response error content of messages. */
                responseErrorContentSearch?: string[];
                /** @description Searches a custom metadata column. Value should be in the form: COLUMN_NAME &lt;operator&gt; value, where operator is one of the following: =, !=, <, <=, >, >=, CONTAINS, DOES NOT CONTAIN, STARTS WITH, DOES NOT START WITH, ENDS WITH, DOES NOT END WITH */
                metaDataSearch?: components["schemas"]["MetaDataSearch"][];
                /** @description Searches a custom metadata column, ignoring case. Value should be in the form: COLUMN_NAME &lt;operator&gt; value. */
                metaDataCaseInsensitiveSearch?: components["schemas"]["MetaDataSearch"][];
                /** @description When using a text search, these custom metadata columns will also be searched. */
                textSearchMetaDataColumn?: string[];
                /** @description The minimum number of send attempts for connector messages. */
                minSendAttempts?: number;
                /** @description The maximum number of send attempts for connector messages. */
                maxSendAttempts?: number;
                /** @description If true, only messages with attachments are included in the results. */
                attachment?: boolean;
                /** @description If true, only messages with errors are included in the results. */
                error?: boolean;
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
        };
    };
    reprocessMessages: {
        parameters: {
            query?: {
                /** @description If true, the message will overwrite the current one */
                replace?: boolean;
                /** @description If true, the metaDataId parameter will be used to determine which destinations to reprocess the message through. */
                filterDestinations?: boolean;
                /** @description Indicates which destinations to send the message to. */
                metaDataId?: number[];
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        /** @description The MessageFilter object to use to query messages by. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["MessageFilter"];
                "application/json": components["schemas"]["MessageFilter"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    reprocessMessages_1: {
        parameters: {
            query?: {
                /** @description The minimum message ID to query. */
                minMessageId?: number;
                /** @description The maximum message ID to query. */
                maxMessageId?: number;
                /** @description The minimum original message ID to query. Messages that have been reprocessed will retain their original message ID. */
                minOriginalId?: number;
                /** @description The maximum original message ID to query. Messages that have been reprocessed will retain their original message ID. */
                maxOriginalId?: number;
                /** @description The minimum import message ID to query. Messages that have been imported will retain their original message ID under this value. */
                minImportId?: number;
                /** @description The maximum import message ID to query. Messages that have been imported will retain their original message ID under this value. */
                maxImportId?: number;
                /** @description The earliest original received date to query by. Example: 1985-10-26T09:00:00.000-0700 */
                startDate?: string;
                /** @description The latest original received date to query by. Example: 2015-10-21T07:28:00.000-0700 */
                endDate?: string;
                /** @description Searches all message content for this string. This process could take a long time depending on the amount of message content currently stored. Any message content that was encrypted by this channel will not be searchable. */
                textSearch?: string;
                /** @description If true, text search input will be considered a regular expression pattern to be matched. Only supported by PostgreSQL, MySQL and Oracle databases. */
                textSearchRegex?: boolean;
                /** @description Determines which message statuses to query by. */
                status?: ("RECEIVED" | "FILTERED" | "TRANSFORMED" | "SENT" | "QUEUED" | "ERROR" | "PENDING")[];
                /** @description If present, only connector metadata IDs in this list will be queried. */
                includedMetaDataId?: number[];
                /** @description If present, connector metadata IDs in this list will not be queried. */
                excludedMetaDataId?: number[];
                /** @description The server ID associated with messages. */
                serverId?: string;
                /** @description Searches the raw content of messages. */
                rawContentSearch?: string[];
                /** @description Searches the processed raw content of messages. */
                processedRawContentSearch?: string[];
                /** @description Searches the transformed content of messages. */
                transformedContentSearch?: string[];
                /** @description Searches the encoded content of messages. */
                encodedContentSearch?: string[];
                /** @description Searches the sent content of messages. */
                sentContentSearch?: string[];
                /** @description Searches the response content of messages. */
                responseContentSearch?: string[];
                /** @description Searches the response transformed content of messages. */
                responseTransformedContentSearch?: string[];
                /** @description Searches the processed response content of messages. */
                processedResponseContentSearch?: string[];
                /** @description Searches the connector map content of messages. */
                connectorMapContentSearch?: string[];
                /** @description Searches the channel map content of messages. */
                channelMapContentSearch?: string[];
                /** @description Searches the source map content of messages. */
                sourceMapContentSearch?: string[];
                /** @description Searches the response map content of messages. */
                responseMapContentSearch?: string[];
                /** @description Searches the processing error content of messages. */
                processingErrorContentSearch?: string[];
                /** @description Searches the postprocessor error content of messages. */
                postprocessorErrorContentSearch?: string[];
                /** @description Searches the response error content of messages. */
                responseErrorContentSearch?: string[];
                /** @description Searches a custom metadata column. Value should be in the form: COLUMN_NAME &lt;operator&gt; value, where operator is one of the following: =, !=, <, <=, >, >=, CONTAINS, DOES NOT CONTAIN, STARTS WITH, DOES NOT START WITH, ENDS WITH, DOES NOT END WITH */
                metaDataSearch?: components["schemas"]["MetaDataSearch"][];
                /** @description Searches a custom metadata column, ignoring case. Value should be in the form: COLUMN_NAME &lt;operator&gt; value. */
                metaDataCaseInsensitiveSearch?: components["schemas"]["MetaDataSearch"][];
                /** @description When using a text search, these custom metadata columns will also be searched. */
                textSearchMetaDataColumn?: string[];
                /** @description The minimum number of send attempts for connector messages. */
                minSendAttempts?: number;
                /** @description The maximum number of send attempts for connector messages. */
                maxSendAttempts?: number;
                /** @description If true, only messages with attachments are included in the results. */
                attachment?: boolean;
                /** @description If true, only messages with errors are included in the results. */
                error?: boolean;
                /** @description If true, the message will overwrite the current one */
                replace?: boolean;
                /** @description If true, the metaDataId parameter will be used to determine which destinations to reprocess the message through. */
                filterDestinations?: boolean;
                /** @description Indicates which destinations to send the message to. */
                metaDataId?: number[];
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    reprocessMessage: {
        parameters: {
            query?: {
                /** @description If true, the message will overwrite the current one */
                replace?: boolean;
                /** @description If true, the metaDataId parameter will be used to determine which destinations to reprocess the message through. */
                filterDestinations?: boolean;
                /** @description Indicates which destinations to send the message to. */
                metaDataId?: number[];
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The ID of the message. */
                messageId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    removeAllMessagesPost: {
        parameters: {
            query?: {
                /** @description If true, currently running channels will be stopped and restarted as part of the remove process. Otherwise, currently running channels will not be included. */
                restartRunningChannels?: boolean;
                /** @description If true, message statistics will also be cleared. */
                clearStatistics?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The IDs of the channels. */
        requestBody: {
            content: {
                "application/xml": string[];
                "application/json": string[];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    importMessagesServer: {
        parameters: {
            query?: {
                /** @description If true, sub-folders will also be scanned recursively for messages. */
                includeSubfolders?: boolean;
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        /** @description The directory path on the server side to import messages from. */
        requestBody: {
            content: {
                "text/plain": string;
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["MessageImportResult"];
                    "application/json": components["schemas"]["MessageImportResult"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["MessageImportResult"];
                    "application/json": components["schemas"]["MessageImportResult"];
                };
            };
        };
    };
    exportMessagesServer: {
        parameters: {
            query: {
                /** @description The minimum message ID to query. */
                minMessageId?: number;
                /** @description The maximum message ID to query. */
                maxMessageId?: number;
                /** @description The minimum original message ID to query. Messages that have been reprocessed will retain their original message ID. */
                minOriginalId?: number;
                /** @description The maximum original message ID to query. Messages that have been reprocessed will retain their original message ID. */
                maxOriginalId?: number;
                /** @description The minimum import message ID to query. Messages that have been imported will retain their original message ID under this value. */
                minImportId?: number;
                /** @description The maximum import message ID to query. Messages that have been imported will retain their original message ID under this value. */
                maxImportId?: number;
                /** @description The earliest original received date to query by. Example: 1985-10-26T09:00:00.000-0700 */
                startDate?: string;
                /** @description The latest original received date to query by. Example: 2015-10-21T07:28:00.000-0700 */
                endDate?: string;
                /** @description Searches all message content for this string. This process could take a long time depending on the amount of message content currently stored. Any message content that was encrypted by this channel will not be searchable. */
                textSearch?: string;
                /** @description If true, text search input will be considered a regular expression pattern to be matched. Only supported by PostgreSQL, MySQL and Oracle databases. */
                textSearchRegex?: boolean;
                /** @description Determines which message statuses to query by. */
                status?: ("RECEIVED" | "FILTERED" | "TRANSFORMED" | "SENT" | "QUEUED" | "ERROR" | "PENDING")[];
                /** @description If present, only connector metadata IDs in this list will be queried. */
                includedMetaDataId?: number[];
                /** @description If present, connector metadata IDs in this list will not be queried. */
                excludedMetaDataId?: number[];
                /** @description The server ID associated with messages. */
                serverId?: string;
                /** @description Searches the raw content of messages. */
                rawContentSearch?: string[];
                /** @description Searches the processed raw content of messages. */
                processedRawContentSearch?: string[];
                /** @description Searches the transformed content of messages. */
                transformedContentSearch?: string[];
                /** @description Searches the encoded content of messages. */
                encodedContentSearch?: string[];
                /** @description Searches the sent content of messages. */
                sentContentSearch?: string[];
                /** @description Searches the response content of messages. */
                responseContentSearch?: string[];
                /** @description Searches the response transformed content of messages. */
                responseTransformedContentSearch?: string[];
                /** @description Searches the processed response content of messages. */
                processedResponseContentSearch?: string[];
                /** @description Searches the connector map content of messages. */
                connectorMapContentSearch?: string[];
                /** @description Searches the channel map content of messages. */
                channelMapContentSearch?: string[];
                /** @description Searches the source map content of messages. */
                sourceMapContentSearch?: string[];
                /** @description Searches the response map content of messages. */
                responseMapContentSearch?: string[];
                /** @description Searches the processing error content of messages. */
                processingErrorContentSearch?: string[];
                /** @description Searches the postprocessor error content of messages. */
                postprocessorErrorContentSearch?: string[];
                /** @description Searches the response error content of messages. */
                responseErrorContentSearch?: string[];
                /** @description Searches a custom metadata column. Value should be in the form: COLUMN_NAME &lt;operator&gt; value, where operator is one of the following: =, !=, <, <=, >, >=, CONTAINS, DOES NOT CONTAIN, STARTS WITH, DOES NOT START WITH, ENDS WITH, DOES NOT END WITH */
                metaDataSearch?: components["schemas"]["MetaDataSearch"][];
                /** @description Searches a custom metadata column, ignoring case. Value should be in the form: COLUMN_NAME &lt;operator&gt; value. */
                metaDataCaseInsensitiveSearch?: components["schemas"]["MetaDataSearch"][];
                /** @description When using a text search, these custom metadata columns will also be searched. */
                textSearchMetaDataColumn?: string[];
                /** @description The minimum number of send attempts for connector messages. */
                minSendAttempts?: number;
                /** @description The maximum number of send attempts for connector messages. */
                maxSendAttempts?: number;
                /** @description If true, only messages with attachments are included in the results. */
                attachment?: boolean;
                /** @description If true, only messages with errors are included in the results. */
                error?: boolean;
                /** @description The maximum number of messages that will be queried at a time. Default Value: 100 */
                pageSize?: number;
                /** @description The ContentType that will be extracted from the message for writing. If null or not provided, the entire message will be written in serialized format. */
                contentType?: "Raw" | "Processed Raw" | "Transformed" | "Encoded" | "Sent" | "Response" | "Response Transformed" | "Processed Response" | "Connector Map" | "Channel Map" | "Response Map" | "Processing Error" | "Postprocessor Error" | "Response Error" | "Source Map";
                /** @description If true, the content to write will be extracted from the destination message(s), rather than the source message. */
                destinationContent?: boolean;
                /** @description If true, message content will be encrypted before writing. */
                encrypt?: boolean;
                /** @description Determines whether attachments will be included with messages. */
                includeAttachments?: boolean;
                /** @description The base directory to use when resolving relative paths in the root folder. */
                baseFolder?: string;
                /** @description The root folder to contain the written messages/sub-folders. */
                rootFolder: string;
                /** @description A string defining the folder/filename(s) for writing messages. It may contain variables to be replaced. */
                filePattern: string;
                /** @description The file name to use for archive exports. */
                archiveFileName?: string;
                /** @description The archiver format to use to archive messages/folders that are written to the root folder. Valid values: zip, tar */
                archiveFormat?: string;
                /** @description The compressor format to use to compress the archive file. Only valid when using the TAR archive format. Valid values: gz, bzip2 */
                compressFormat?: string;
                /** @description The password used to protect the archive file. Only valid when using the ZIP archive format. */
                password?: string;
                /** @description The algorithm used to encrypt the password-protected archive file. Only valid when using the ZIP archive format. Valid values: STANDARD, AES128, AES256 */
                encryptionType?: "STANDARD" | "AES128" | "AES256";
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
        };
    };
    exportMessagesServer_1: {
        parameters: {
            query?: {
                /** @description The maximum number of messages that will be queried at a time. */
                pageSize?: number;
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    filter: components["schemas"]["MessageFilter"];
                    writerOptions?: components["schemas"]["MessageWriterOptions"];
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
        };
    };
    exportAttachmentServer: {
        parameters: {
            query?: {
                /** @description Indicates that the attachment is binary and should be Base64 decoded before writing to file. */
                binary?: boolean;
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The ID of the message. */
                messageId: number;
                /** @description The ID of the attachment. */
                attachmentId: string;
            };
            cookie?: never;
        };
        /** @description The file path to export the attachment to. */
        requestBody: {
            content: {
                "application/xml": string;
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    auditQueriedPHIMessage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The attributes map of the channel messages filter. */
        requestBody?: {
            content: {
                "application/xml": {
                    [key: string]: string;
                };
                "application/json": {
                    [key: string]: string;
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    auditExportMessages: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The attributes map of the channel messages export. */
        requestBody?: {
            content: {
                "application/xml": {
                    [key: string]: string;
                };
                "application/json": {
                    [key: string]: string;
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getMessages: {
        parameters: {
            query?: {
                /** @description The minimum message ID to query. */
                minMessageId?: number;
                /** @description The maximum message ID to query. */
                maxMessageId?: number;
                /** @description The minimum original message ID to query. Messages that have been reprocessed will retain their original message ID. */
                minOriginalId?: number;
                /** @description The maximum original message ID to query. Messages that have been reprocessed will retain their original message ID. */
                maxOriginalId?: number;
                /** @description The minimum import message ID to query. Messages that have been imported will retain their original message ID under this value. */
                minImportId?: number;
                /** @description The maximum import message ID to query. Messages that have been imported will retain their original message ID under this value. */
                maxImportId?: number;
                /** @description The earliest original received date to query by. Example: 1985-10-26T09:00:00.000-0700 */
                startDate?: string;
                /** @description The latest original received date to query by. Example: 2015-10-21T07:28:00.000-0700 */
                endDate?: string;
                /** @description Searches all message content for this string. This process could take a long time depending on the amount of message content currently stored. Any message content that was encrypted by this channel will not be searchable. */
                textSearch?: string;
                /** @description If true, text search input will be considered a regular expression pattern to be matched. Only supported by PostgreSQL, MySQL and Oracle databases. */
                textSearchRegex?: boolean;
                /** @description Determines which message statuses to query by. */
                status?: ("RECEIVED" | "FILTERED" | "TRANSFORMED" | "SENT" | "QUEUED" | "ERROR" | "PENDING")[];
                /** @description If present, only connector metadata IDs in this list will be queried. */
                includedMetaDataId?: number[];
                /** @description If present, connector metadata IDs in this list will not be queried. */
                excludedMetaDataId?: number[];
                /** @description The server ID associated with messages. */
                serverId?: string;
                /** @description Searches the raw content of messages. */
                rawContentSearch?: string[];
                /** @description Searches the processed raw content of messages. */
                processedRawContentSearch?: string[];
                /** @description Searches the transformed content of messages. */
                transformedContentSearch?: string[];
                /** @description Searches the encoded content of messages. */
                encodedContentSearch?: string[];
                /** @description Searches the sent content of messages. */
                sentContentSearch?: string[];
                /** @description Searches the response content of messages. */
                responseContentSearch?: string[];
                /** @description Searches the response transformed content of messages. */
                responseTransformedContentSearch?: string[];
                /** @description Searches the processed response content of messages. */
                processedResponseContentSearch?: string[];
                /** @description Searches the connector map content of messages. */
                connectorMapContentSearch?: string[];
                /** @description Searches the channel map content of messages. */
                channelMapContentSearch?: string[];
                /** @description Searches the source map content of messages. */
                sourceMapContentSearch?: string[];
                /** @description Searches the response map content of messages. */
                responseMapContentSearch?: string[];
                /** @description Searches the processing error content of messages. */
                processingErrorContentSearch?: string[];
                /** @description Searches the postprocessor error content of messages. */
                postprocessorErrorContentSearch?: string[];
                /** @description Searches the response error content of messages. */
                responseErrorContentSearch?: string[];
                /** @description Searches a custom metadata column. Value should be in the form: COLUMN_NAME &lt;operator&gt; value, where operator is one of the following: =, !=, <, <=, >, >=, CONTAINS, DOES NOT CONTAIN, STARTS WITH, DOES NOT START WITH, ENDS WITH, DOES NOT END WITH */
                metaDataSearch?: components["schemas"]["MetaDataSearch"][];
                /** @description Searches a custom metadata column, ignoring case. Value should be in the form: COLUMN_NAME &lt;operator&gt; value. */
                metaDataCaseInsensitiveSearch?: components["schemas"]["MetaDataSearch"][];
                /** @description When using a text search, these custom metadata columns will also be searched. */
                textSearchMetaDataColumn?: string[];
                /** @description The minimum number of send attempts for connector messages. */
                minSendAttempts?: number;
                /** @description The maximum number of send attempts for connector messages. */
                maxSendAttempts?: number;
                /** @description If true, only messages with attachments are included in the results. */
                attachment?: boolean;
                /** @description If true, only messages with errors are included in the results. */
                error?: boolean;
                /** @description If true, message content will be returned with the results. */
                includeContent?: boolean;
                /** @description Used for pagination, determines where to start in the search results. */
                offset?: number;
                /** @description Used for pagination, determines the maximum number of results to return. */
                limit?: number;
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Message"][];
                    "application/json": components["schemas"]["Message"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Message"][];
                    "application/json": components["schemas"]["Message"][];
                };
            };
        };
    };
    processMessage: {
        parameters: {
            query?: {
                /** @description Indicates which destinations to send the message to. */
                destinationMetaDataId?: number[];
                /** @description These entries will be injected into the source map for the message. Value should be in the format: key=value */
                sourceMapEntry?: string[];
                /** @description If true and a valid original message ID is given, this message will overwrite the existing one. */
                overwrite?: boolean;
                /** @description If true, marks this message as being imported. If the message is overwriting an existing one, then statistics will not be decremented. */
                imported?: boolean;
                /** @description The original message ID this message is associated with. */
                originalMessageId?: number;
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        /** @description The raw message data to process. */
        requestBody: {
            content: {
                "text/plain": string;
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
        };
    };
    removeMessages_1: {
        parameters: {
            query?: {
                /** @description The minimum message ID to query. */
                minMessageId?: number;
                /** @description The maximum message ID to query. */
                maxMessageId?: number;
                /** @description The minimum original message ID to query. Messages that have been reprocessed will retain their original message ID. */
                minOriginalId?: number;
                /** @description The maximum original message ID to query. Messages that have been reprocessed will retain their original message ID. */
                maxOriginalId?: number;
                /** @description The minimum import message ID to query. Messages that have been imported will retain their original message ID under this value. */
                minImportId?: number;
                /** @description The maximum import message ID to query. Messages that have been imported will retain their original message ID under this value. */
                maxImportId?: number;
                /** @description The earliest original received date to query by. Example: 1985-10-26T09:00:00.000-0700 */
                startDate?: string;
                /** @description The latest original received date to query by. Example: 2015-10-21T07:28:00.000-0700 */
                endDate?: string;
                /** @description Searches all message content for this string. This process could take a long time depending on the amount of message content currently stored. Any message content that was encrypted by this channel will not be searchable. */
                textSearch?: string;
                /** @description If true, text search input will be considered a regular expression pattern to be matched. Only supported by PostgreSQL, MySQL and Oracle databases. */
                textSearchRegex?: boolean;
                /** @description Determines which message statuses to query by. */
                status?: ("RECEIVED" | "FILTERED" | "TRANSFORMED" | "SENT" | "QUEUED" | "ERROR" | "PENDING")[];
                /** @description If present, only connector metadata IDs in this list will be queried. */
                includedMetaDataId?: number[];
                /** @description If present, connector metadata IDs in this list will not be queried. */
                excludedMetaDataId?: number[];
                /** @description The server ID associated with messages. */
                serverId?: string;
                /** @description Searches the raw content of messages. */
                rawContentSearch?: string[];
                /** @description Searches the processed raw content of messages. */
                processedRawContentSearch?: string[];
                /** @description Searches the transformed content of messages. */
                transformedContentSearch?: string[];
                /** @description Searches the encoded content of messages. */
                encodedContentSearch?: string[];
                /** @description Searches the sent content of messages. */
                sentContentSearch?: string[];
                /** @description Searches the response content of messages. */
                responseContentSearch?: string[];
                /** @description Searches the response transformed content of messages. */
                responseTransformedContentSearch?: string[];
                /** @description Searches the processed response content of messages. */
                processedResponseContentSearch?: string[];
                /** @description Searches the connector map content of messages. */
                connectorMapContentSearch?: string[];
                /** @description Searches the channel map content of messages. */
                channelMapContentSearch?: string[];
                /** @description Searches the source map content of messages. */
                sourceMapContentSearch?: string[];
                /** @description Searches the response map content of messages. */
                responseMapContentSearch?: string[];
                /** @description Searches the processing error content of messages. */
                processingErrorContentSearch?: string[];
                /** @description Searches the postprocessor error content of messages. */
                postprocessorErrorContentSearch?: string[];
                /** @description Searches the response error content of messages. */
                responseErrorContentSearch?: string[];
                /** @description Searches a custom metadata column. Value should be in the form: COLUMN_NAME &lt;operator&gt; value, where operator is one of the following: =, !=, <, <=, >, >=, CONTAINS, DOES NOT CONTAIN, STARTS WITH, DOES NOT START WITH, ENDS WITH, DOES NOT END WITH */
                metaDataSearch?: components["schemas"]["MetaDataSearch"][];
                /** @description Searches a custom metadata column, ignoring case. Value should be in the form: COLUMN_NAME &lt;operator&gt; value. */
                metaDataCaseInsensitiveSearch?: components["schemas"]["MetaDataSearch"][];
                /** @description When using a text search, these custom metadata columns will also be searched. */
                textSearchMetaDataColumn?: string[];
                /** @description The minimum number of send attempts for connector messages. */
                minSendAttempts?: number;
                /** @description The maximum number of send attempts for connector messages. */
                maxSendAttempts?: number;
                /** @description If true, only messages with attachments are included in the results. */
                attachment?: boolean;
                /** @description If true, only messages with errors are included in the results. */
                error?: boolean;
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    processMessage_1: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        /** @description The RawMessage object to process. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["RawMessage"];
                "application/json": components["schemas"]["RawMessage"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
        };
    };
    getMessageContent: {
        parameters: {
            query?: {
                /** @description The metadata IDs of the connectors. */
                metaDataId?: number[];
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The ID of the message. */
                messageId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Message"];
                    "application/json": components["schemas"]["Message"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Message"];
                    "application/json": components["schemas"]["Message"];
                };
            };
        };
    };
    removeMessage: {
        parameters: {
            query?: {
                /** @description If present, only the specific connector message will be removed. If the metadata ID is 0, the entire message will be removed. */
                metaDataId?: number;
                /** @description The patient ID of the channel message. */
                patientId?: string;
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The ID of the message. */
                messageId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    importMessage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        /** @description The Message object to import. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["Message"];
                "application/json": components["schemas"]["Message"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    auditAccessedPHIMessage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The attributes map of the channel message. */
        requestBody?: {
            content: {
                "application/xml": {
                    [key: string]: string;
                };
                "application/json": {
                    [key: string]: string;
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    auditExportMessagesSuccess: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The attributes map of the channel messages export. */
        requestBody?: {
            content: {
                "application/xml": {
                    [key: string]: string;
                };
                "application/json": {
                    [key: string]: string;
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getMessages_1: {
        parameters: {
            query?: {
                /** @description If true, message content will be returned with the results. */
                includeContent?: boolean;
                /** @description Used for pagination, determines where to start in the search results. */
                offset?: number;
                /** @description Used for pagination, determines the maximum number of results to return. */
                limit?: number;
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        /** @description The MessageFilter object to use to query messages by. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["MessageFilter"];
                "application/json": components["schemas"]["MessageFilter"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Message"][];
                    "application/json": components["schemas"]["Message"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Message"][];
                    "application/json": components["schemas"]["Message"][];
                };
            };
        };
    };
    removeMessages: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        /** @description The MessageFilter object to use to query messages by. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["MessageFilter"];
                "application/json": components["schemas"]["MessageFilter"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    removeAllMessages: {
        parameters: {
            query: {
                /** @description The IDs of the channels. */
                channelId: string[];
                /** @description If true, currently running channels will be stopped and restarted as part of the remove process. Otherwise, currently running channels will not be included. */
                restartRunningChannels?: boolean;
                /** @description If true, message statistics will also be cleared. */
                clearStatistics?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    removeAllMessages_1: {
        parameters: {
            query?: {
                /** @description If true, currently running channels will be stopped and restarted as part of the remove process. Otherwise, currently running channels will not be included. */
                restartRunningChannels?: boolean;
                /** @description If true, message statistics will also be cleared. */
                clearStatistics?: boolean;
            };
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getAttachment: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The ID of the message. */
                messageId: number;
                /** @description The ID of the attachment. */
                attachmentId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Attachment"];
                    "application/json": components["schemas"]["Attachment"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["Attachment"];
                    "application/json": components["schemas"]["Attachment"];
                };
            };
        };
    };
    getMaxMessageId: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The ID of the channel. */
                channelId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": number;
                    "application/json": number;
                };
            };
        };
    };
    getInfo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["SystemInfo"];
                    "application/json": components["schemas"]["SystemInfo"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["SystemInfo"];
                    "application/json": components["schemas"]["SystemInfo"];
                };
            };
        };
    };
    getStats: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["SystemStats"];
                    "application/json": components["schemas"]["SystemStats"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["SystemStats"];
                    "application/json": components["schemas"]["SystemStats"];
                };
            };
        };
    };
    getUsageData: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The map of client usage data to use. */
        requestBody: {
            content: {
                "application/xml": {
                    [key: string]: Record<string, never>;
                };
                "application/json": {
                    [key: string]: Record<string, never>;
                };
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string;
                    "application/json": string;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string;
                    "application/json": string;
                };
            };
        };
    };
    inactivityLogout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    checkUserPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The plaintext password to check. */
        requestBody: {
            content: {
                "text/plain": string;
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
        };
    };
    getAllUsers: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["User"][];
                    "application/json": components["schemas"]["User"][];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["User"][];
                    "application/json": components["schemas"]["User"][];
                };
            };
        };
    };
    createUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The User object to create. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["User"];
                "application/json": components["schemas"]["User"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    updateUserPassword: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The unique ID of the user to update the password for. */
                userId: number;
            };
            cookie?: never;
        };
        /** @description The plaintext password to update with. */
        requestBody: {
            content: {
                "text/plain": string;
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string[];
                    "application/json": string[];
                };
            };
        };
    };
    getCurrentUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["User"];
                    "application/json": components["schemas"]["User"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["User"];
                    "application/json": components["schemas"]["User"];
                };
            };
        };
    };
    getUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The unique ID or username of the user to retrieve. */
                userIdOrName: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["User"];
                    "application/json": components["schemas"]["User"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["User"];
                    "application/json": components["schemas"]["User"];
                };
            };
        };
    };
    updateUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The unique ID of the user to update. */
                userId: number;
            };
            cookie?: never;
        };
        /** @description The User object to update. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["User"];
                "application/json": components["schemas"]["User"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    removeUser: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The unique ID of the user to remove. */
                userId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    isUserLoggedIn: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The unique ID of the user. */
                userId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": boolean;
                    "application/json": boolean;
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": boolean;
                    "application/json": boolean;
                };
            };
        };
    };
    getUserPreference: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The unique ID of the user. */
                userId: number;
                /** @description The name of the user property to retrieve. */
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": string;
                };
            };
        };
    };
    setUserPreference: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The unique ID of the user. */
                userId: number;
                /** @description The name of the user property to update. */
                name: string;
            };
            cookie?: never;
        };
        /** @description The value to update the property with. */
        requestBody: {
            content: {
                "text/plain": string;
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getUserPreferences: {
        parameters: {
            query?: {
                /** @description An optional set of property names to filter by. */
                name?: string[];
            };
            header?: never;
            path: {
                /** @description The unique ID of the user. */
                userId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string;
                    "application/json": string;
                };
            };
        };
    };
    setUserPreferences: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The unique ID of the user. */
                userId: number;
            };
            cookie?: never;
        };
        /** @description The properties to update for the user. */
        requestBody: {
            content: {
                "application/xml": string;
                "application/json": string;
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    /** @default admin */
                    username: string;
                    /** @default admin */
                    password: string;
                };
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["LoginStatus"];
                    "application/json": components["schemas"]["LoginStatus"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["LoginStatus"];
                    "application/json": components["schemas"]["LoginStatus"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    setUserNotificationAcknowledged: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The unique ID of the user. */
                userId: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getDefinition_1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    /** @description The ID of the channel. */
                    channelId: string;
                    /** @description The name of the channel. */
                    channelName?: string;
                    /** @description The full URL to the WSDL describing the web service method to be called. */
                    wsdlUrl: string;
                    /** @description Username used to authenticate to the web server. */
                    username?: string;
                    /** @description Password used to authenticate to the web server. */
                    password?: string;
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DefinitionServiceMap"];
                    "application/json": components["schemas"]["DefinitionServiceMap"];
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["DefinitionServiceMap"];
                    "application/json": components["schemas"]["DefinitionServiceMap"];
                };
            };
        };
    };
    isWsdlCached_1: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/x-www-form-urlencoded": {
                    /** @description The ID of the channel. */
                    channelId: string;
                    /** @description The name of the channel. */
                    channelName?: string;
                    /** @description The full URL to the WSDL describing the web service method to be called. */
                    wsdlUrl: string;
                    /** @description Username used to authenticate to the web server. */
                    username?: string;
                    /** @description Password used to authenticate to the web server. */
                    password?: string;
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": boolean;
                    "application/json": boolean;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": boolean;
                    "application/json": boolean;
                };
            };
        };
    };
    getKeystore: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Retrieve current additional keystore as byte array */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
        };
    };
    setTruststore: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "multipart/form-data": {
                    /**
                     * Format: binary
                     * @description The truststore file to upload.
                     */
                    file?: string;
                    /** @description Truststore password */
                    password?: string;
                };
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string;
                    "application/json": string;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": string;
                    "application/json": string;
                };
            };
        };
    };
    getPublicCertificates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Found the information */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": string;
                    "application/xml": string;
                };
            };
        };
    };
    getClientCertificates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Found the information */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": string;
                    "application/xml": string;
                };
            };
        };
    };
    getSystemCertificates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Retrieve certificates from system truststore */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": string;
                    "application/xml": string;
                };
            };
        };
    };
    getRemoteCertificates: {
        parameters: {
            query?: {
                /** @description The URL which to query for served certificates */
                url?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Retrieve certificates served from a URL */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": string;
                    "application/xml": string;
                };
            };
        };
    };
    testHttpsConnection: {
        parameters: {
            query: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The name of the channel. */
                channelName: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The HTTP Sender properties to use. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["HttpDispatcherProperties"];
                "application/json": components["schemas"]["HttpDispatcherProperties"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResult"];
                    "application/json": components["schemas"]["ConnectionTestResult"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResult"];
                    "application/json": components["schemas"]["ConnectionTestResult"];
                };
            };
        };
    };
    getTrustedCertificates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Retrieve certificates from current additional truststore */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": string;
                    "application/xml": string;
                };
            };
        };
    };
    setTrustedCertificates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The list of certificates to write to the truststore. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["TrustedCertificate"][];
                "application/json": components["schemas"]["TrustedCertificate"][];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    getLocalCertificates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Retrieve certificate/key pairs from current additional keystore */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": string;
                    "application/xml": string;
                };
            };
        };
    };
    setLocalCertificates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The list of certificate/key pairs to write to the keystore. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["LocalCertificate"][];
                "application/json": components["schemas"]["LocalCertificate"][];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": unknown;
                    "application/json": unknown;
                };
            };
        };
    };
    testTcpConnection: {
        parameters: {
            query: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The name of the channel. */
                channelName: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The TCP Sender properties to use. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["TcpDispatcherProperties"];
                "application/json": components["schemas"]["TcpDispatcherProperties"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResult"];
                    "application/json": components["schemas"]["ConnectionTestResult"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResult"];
                    "application/json": components["schemas"]["ConnectionTestResult"];
                };
            };
        };
    };
    testWsConnection: {
        parameters: {
            query: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The name of the channel. */
                channelName: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The WebService Sender properties to use. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["WebServiceDispatcherProperties"];
                "application/json": components["schemas"]["WebServiceDispatcherProperties"];
            };
        };
        responses: {
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResult"];
                    "application/json": components["schemas"]["ConnectionTestResult"];
                };
            };
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": components["schemas"]["ConnectionTestResult"];
                    "application/json": components["schemas"]["ConnectionTestResult"];
                };
            };
        };
    };
    cacheWsdlFromUrl_1: {
        parameters: {
            query: {
                /** @description The ID of the channel. */
                channelId: string;
                /** @description The name of the channel. */
                channelName?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** @description The Web Service Sender properties to use. These properties can be found in the exported channel's XML file. Copy the data from the opening tag &lt;destinationConnectorProperties&gt; to the closing tag &lt;/wsdlDefinitionMap&gt; (including the tags). Paste over the information below between the opening and closing tags for &lt;com.mirth.connect.connectors.ws.WebServiceDispatcherProperties&gt;. */
        requestBody: {
            content: {
                "application/xml": components["schemas"]["WebServiceDispatcherProperties"];
                "application/json": components["schemas"]["WebServiceDispatcherProperties"];
            };
        };
        responses: {
            /** @description default response */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": Record<string, never>;
                    "application/json": Record<string, never>;
                };
            };
            /** @description default response */
            "2XX": {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/xml": Record<string, never>;
                    "application/json": Record<string, never>;
                };
            };
        };
    };
}
