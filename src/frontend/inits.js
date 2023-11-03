/**
 * @file Initialization library used by Node-RED editor
 * @author Metz Connect
 */

/**
 * Authentication namespace.
 * @namespace Inits
 */

/**
 * Flag to write logs to browsers console.
 * @memberof Inits
 * @type {bool}
 */
let LOG_DEBUG = false;

/**
 * Logs messages to console.
 * @memberof Inits
 * @param {string} msg - The log message.
 */
function log(msg) {
    // debug logs enabled
    if (LOG_DEBUG) {
        // write log to console
        console.log(msg);
    }
}

/**
 * Enables or disables html elements which are related to hostname.
 * @memberof Inits
 * @param {bool} enable - flag for enabling or disabling elements (true = enable).
 */
function enableHostElements(enable) {
    $("#node-config-input-host").prop("disabled", !enable);
    $("#btn-discover-ewios").prop("disabled", !enable);
    $("#btn-info-ewios").prop("disabled", !enable);
}

/**
 * Enables or disables html element SSL/TLS and shows or hides the tls-config row.
 * @memberof Inits
 * @param {bool} enable - flag for enabling or disabling elements (true = enable).
 */
function enableShowTlsElements(enable) {
    // encryption checkbox
    $("#node-config-input-encryption").prop("disabled", !enable);
    // edit button for tls-config
    if (enable) {
        // show tls-config row, only if SSL/TLS checkbox is checked
        if ($("#node-config-input-encryption").is(":checked")) {
            $('#node-row-tlsConfig').show();
        }
    }
    // hide tls-config row
    else {
        $('#node-row-tlsConfig').hide();
    }
}

/**
 * Starts discovery mode to find EWIO2 in same networks.
 * Shows spin symbol on discovery button, disables all html elements which are related to hostname and deletes previously discovered EWIO2 from dropdown.
 * @memberof Inits
 * @param {Object} languageStrings - info strings (in selected browser language) of the current EWIO2, e.g. "noInfo" and "thisDevice".
 */
function startDiscovery(languageStrings) {
    // show spin symbpl on button
    $("#btn-discover-ewios > i").attr("class", "fa fa-refresh fa-spin fa-fw");
    // disable inputs and button
    enableHostElements(false);
    // disable TLS settings
    enableShowTlsElements(false);
    // remove all previously discoverd EWIO2
    $("#node-config-input-host option").remove();
    
    $.post("get/ewio2/discovery", languageStrings, function(data) { });
}

/**
 * Functionality to be executed at end of discovery mode.
 * Shows search symbol on discovery button and enables all html elements which are related to hostname
 * @memberof Inits
 */
function endDiscovery() {
    // show search symbol on button
    $("#btn-discover-ewios > i").attr("class", "fa fa-fw fa-search");
    // enable inputs and button
    enableHostElements(true);
    enableShowTlsElements(true);
}

/**
 * checks if a keyword is already available in dropdown list.
 * @memberof Inits
 * @param {string} keyword - This keyword is checked, if it is already available in dropdown list.
 * @param {string} dropdownListName - Name of the dropdown list
 * @return {bool} flag if keyword is already available in dropdown list.
 */
function optionExists (keyword, dropdownListName ) {
    var dropdownList = $(dropdownListName + " option");
    var optExists = false;
    dropdownList.each(function() {
        if ($(this).val() == keyword) {
            optExists = true;
        }
    });
    return optExists;
}

/**
 * Enabled or disables the html elements of a node. Disabled while trying to connect to EWIO2 configuration node.
 * @memberof Inits
 * @param {bool} enable - Enable the elements (true) or disable them (false).
 * @param {string} ioPort - Which of the IO ports / meter / datapoint should be enabled / disabled.
 */
function enableHtmlElements(enable, ioPort) {
    $("#node-input-ewio2").prop('disabled',!enable);
    if (ioPort) {
        enableIoPortElement(ioPort, enable);
    }
    $("#node-input-name").prop('disabled',!enable);
}

/**
 * Enabled or disables especially an ioPort html element. Function is used for all types of IOs (DO, AO, DI, AI)
 * @memberof Inits
 * @param {bool} enable - Enable the element (true) or disable it (false).
 */
function enableIoPortElement(ioPort, enable) {
    $("#node-input-" + ioPort).prop('disabled',!enable);
}

/**
 * Enabled or disables especially digital input related html elements.
 * @memberof Inits
 * @param {bool} enable - Enable the elements (true) or disable it (false).
 */
function enableDiSpecificElements(enable) {
    $("#node-input-inputSignal").prop("disabled", !enable);
    $("#node-input-risingEdge").prop("disabled", !enable);
    $("#node-input-fallingEdge").prop("disabled", !enable);
}

/**
 * Enabled or disables especially analog input related html elements.
 * @memberof Inits
 * @param {bool} enable - Enable the elements (true) or disable it (false).
 * @param {bool} enableValueConfig - Enable the analog input configuration dropdown (true) or disable it (false).
 */
function enableAiSpecificElements(enable, enableValueConfig) {
    // enable analog input configuration dropdown only if both flags are set
    if (enable && enableValueConfig) {
        $("#node-input-valueConfig").prop("disabled", false);
    }
    else {
        $("#node-input-valueConfig").prop("disabled", true);
    }
    $("#btn-info-aiConfig").prop("disabled", !enable);
    if (!enable) {
        $("#lbl-aiConfig-exclamationMark").hide();
    }
    $("#node-input-inputSignal").prop("disabled", !enable);
    $("#node-input-valueUpdate").prop("disabled", !enable);
}

/**
 * Enabled or disables especially metering related html elements.
 * @memberof Inits
 * @param {bool} enable - Enable the elements (true) or disable it (false).
 */
function enableCounterSpecificElements(enable) {
    $("#node-input-outputTimestamp").prop("disabled", !enable);
    $("#node-input-outputFlags").prop("disabled", !enable);
}

/**
 * Enabled or disables the topic (additionally topic as node output) html element.
 * @memberof Inits
 * @param {bool} enable - Enable the element (true) or disable it (false).
 */
function enableTopicElement(enable) {
    $("#node-input-outputTopic").prop('disabled',!enable);
}

/**
 * Sets the pulse counter value and shows either pulse counter value (pulse counter) or status (signal input).
 * @memberof Inits
 * @param {string} value - Pulse counter value.
 * @param {string} active - Pulse counter mode active ("1") or signal input active.
 * @param {Object} node - Current selected node in digital input configuration menu. Needed to update label with internationalized text.
 */
function toggleDiPulseCntrStatusValue(value, active, node) {
    $("#node-input-valueText").val(value);
    // pulse counter active
    if (active === "1") {
        $("#section-valueText").show();
        $("#section-value").hide();
        $("#lbl-risingEdge").text(node._("@metz-connect/node-red-ewio2/ewio2:label.valueUpdate"));
        $("#section-fallingEdge").hide();
        // uncheck falling edge checkbox, makes no sense for pulse counter
        $("#node-input-fallingEdge").prop("checked", false);
    }
    // signal value active
    else {
        $("#section-valueText").hide();
        $("#section-value").show();
        $("#lbl-risingEdge").text(node._("@metz-connect/node-red-ewio2/ewio2:label.risingEdge"));
        $("#section-fallingEdge").show();
    }
}

/**
 * Retieves the configuration node and creates a data structure with data of configuration node.
 * @memberof Inits
 * @param {string} configNodeId - Identification of the EWIO2 configuration node.
 * @param {string} nodeId - Identification of the node.
 * @return {Object} Object with configuration node ID,  host, user (optional), pw (optional) and encryption flag, used as key for ewio2Connections object. Optional values may be overwritten by backend.
 */
function getConfigNodeDataStructure(configNodeId, nodeId) {
    const configNode = RED.nodes.node(configNodeId);
    var configDataWithCert = {};
    var configData = {};
    configData.configNodeId = configNodeId;
    configData.nodeId = nodeId;
    configDataWithCert.data = configData;
    if (configNode) {
        configData.host = configNode.host;
        if (configNode.credentials) {
            configData.user = configNode.credentials.username;
            configData.pw = configNode.credentials.password;
        }
        configData.enc = configNode.encryption;
        configDataWithCert.data = configData;
        if (configNode.tlsConfig) {
            const tlsRedObj = RED.nodes.node(configNode.tlsConfig);
            var tlsConfigObj = {tlsConfigId: configNode.tlsConfig, credentials: tlsRedObj.credentials, verifyservercert: tlsRedObj.verifyservercert, servername: tlsRedObj.servername, alpnprotocol: tlsRedObj.alpnprotocol};
            configDataWithCert.tlsConfig = tlsConfigObj;
        }
    }
    return configDataWithCert
}

/**
 * Prepares data for closing websocket connection and starts closeDeleteWebsocket function.
 * @memberof Inits
 * @param {string} configNodeId - Identification of the EWIO2 configuration node.
 * @param {string} nodeId - Identification of the node.
 */
async function prepareCloseWebsocket(configNodeId, nodeId) {
    if (!configNodeId || configNodeId == "_ADD_") {
        log("NO configNode");
        return;
    }
    log(configNodeId + " close and delete websocket connection")
    const dataStruct = getConfigNodeDataStructure(configNodeId, nodeId);
    await closeDeleteWebsocket(dataStruct.data);
    log("close delete websocket done");
}

/**
 * Stores all analog input configuration values for non-MR-CI4 extension modules or EWIO2 itself.
 * @memberof Inits
 * @type {Map}
 */
const sensorAI = new Map();

/**
 * Stores all analog input configuration values for MR-CI4 extension modules.
 * @memberof Inits
 * @type {Map}
 */
const sensorAI_mrCi4 = new Map();

/**
 * Initialization of analog input sensor configuration. Loads all configurations into map. Distinguish between MR-CI4 extension module and "other" modules (or EWIO2 itself).
 * @memberof Inits
 * @param {Object} node - The currently selected analog input node (needed to load translation).
 */
function initSensorAI(node) {
    sensorAI.set("0", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.inactive_"));
    sensorAI.set("1", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.volt_0_10_pc_%"));
    sensorAI.set("2", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.volt_0_5_pl_pc_%"));
    sensorAI.set("3", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.volt_0_10_V"));
    sensorAI.set("4", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.volt_0_5_pl_V"));
    sensorAI.set("5", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ohm_40_4m_ohm"));
    sensorAI.set("6", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.usr_def"));
    sensorAI.set("7", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.pt100_°C"));
    sensorAI.set("8", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.pt500_°C"));
    sensorAI.set("9", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.pt1000_°C"));
    sensorAI.set("10", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ni1000_tc5000_°C"));
    sensorAI.set("11", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ni1000_tc6180_°C"));
    sensorAI.set("12", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.balco500_°C"));
    sensorAI.set("13", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.kty81_110_°C"));
    sensorAI.set("14", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.kty81_210_°C"));
    sensorAI.set("15", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ntc_1k8_th_°C"));
    sensorAI.set("16", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ntc_5k_th_°C"));
    sensorAI.set("17", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ntc_10k_th_°C"));
    sensorAI.set("18", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ntc_20k_th_°C"));
    sensorAI.set("19", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.lm235z_°C"));
    sensorAI.set("20", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ntc_10k_carel_°C"));
    sensorAI.set("21", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ntc_5k_sch_°C"));
    sensorAI.set("22", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ntc_30k_sch_°C"));
    sensorAI.set("23", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.kp250_°C"));
    sensorAI.set("24", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.poti_10k_pc_%"));
    sensorAI.set("25", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.inactive2_"));
    sensorAI.set("26", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ampere_0_20_pc_%"));
    sensorAI.set("27", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ampere_0_20_mA"));
    sensorAI.set("28", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ampere_4_20_pc_%"));
    sensorAI.set("29", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ampere_4_20_mA"));
    sensorAI.set("30", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.3wire_sens_0_14k_kohm"));
    sensorAI.set("31", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.4wire_sens_0_14k_kohm"));

    sensorAI_mrCi4.set("0", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.inactive_"));
    sensorAI_mrCi4.set("1", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.volt_0_10_pc_%"));
    sensorAI_mrCi4.set("2", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.volt_0_10_V"));
    sensorAI_mrCi4.set("3", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ampere_0_20_pc_%"));
    sensorAI_mrCi4.set("4", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ampere_0_20_mA"));
    sensorAI_mrCi4.set("5", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ampere_4_20_pc_%"));
    sensorAI_mrCi4.set("6", node._("@metz-connect/node-red-ewio2/ewio2:sensorAI.ampere_4_20_mA"));
}

/**
 * Stores all datapoint ranges (time intervals).
 * @memberof Inits
 * @type {Map}
 */
const dpRanges = new Map();

/**
 * Initialization of datapoint ranges. Loads all configurations into map.
 * @memberof Inits
 * @param {Object} node - The currently selected counter node (needed to load translation).
 */
function initDatapointRanges(node) {
    dpRanges.set("-8", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_30s"));
    dpRanges.set("-7", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_20s"));
    dpRanges.set("-6", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_15s"));
    dpRanges.set("-5", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_10s"));
    dpRanges.set("-4", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_5s"));
    dpRanges.set("-3", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_1s"));
    dpRanges.set("-2", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_syncpulse"));
    dpRanges.set("-1", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_event"));
    dpRanges.set("0", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_none"));
    dpRanges.set("1", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_1min"));
    dpRanges.set("2", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_5min"));
    dpRanges.set("3", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_10min"));
    dpRanges.set("4", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_15min"));
    dpRanges.set("5", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_30min"));
    dpRanges.set("6", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_1h"));
    dpRanges.set("7", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_2h"));
    dpRanges.set("8", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_4h"));
    dpRanges.set("9", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_6h"));
    dpRanges.set("10", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_12h"));
    dpRanges.set("11", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_daily"));
    dpRanges.set("12", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_weekly"));
    dpRanges.set("13", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_monthly"));
    dpRanges.set("14", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_quarterly"));
    dpRanges.set("15", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_semiannual"));
    dpRanges.set("16", node._("@metz-connect/node-red-ewio2/ewio2:dpRanges.interval_yearly"));
}
