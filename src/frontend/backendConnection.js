/**
 * @file ibrary used by Node-RED editor to connect to Node-RED backend.
 * @author Metz Connect
 */

/**
 * Node-RED backend connection namespace.
 * @namespace BackendConnection
 */

/**
 * "Lock" variable which blocks 2nd function call (when config menu is opened, two times onchange triggers). Semaphores are not available in JavaScript. 2nd function call is not a duplicate (can be blocked).
 * @memberof BackendConnection
 * @type {bool}
 */
let getConfigLocked = false;

/**
 * Sends the request with all data as content to Node-RED runtime, which connects to ioManager websocket of EWIO2 and requests data of ioType.
 * @memberof BackendConnection
 * @param {Object} configNodeData - Object with configuration node ID,  host, user (optional), pw (optional) and encryption flag, used as key for ewio2Connections object. Optional values may be overwritten by backend.
 * @param {string} iotype - Establish websocket connection for ioType (analog in, analog out, digital in or digital out).
 * @param {string} prevIoPort - The last selected element of the port dropdown. Used to re-select again, after new data are received.
 * @param {string} nodeId - Identification of the node, which requests EWIO2 IO data.
 * @param {string} counterAddr - Address or ID of meter (only for requesting datapoints). undefined for all other requests.
 * @return {Promise} Was the connection to Node-RED runtime successful (resolve) or failed (reject).
 */
function getEwio2ConfigData(configNodeData, iotype, prevIoPort, nodeId, counterAddr) {
    // set "undefined", to send string to backend, which will be published also back to frontend
    if (!prevIoPort) {
        prevIoPort = "undefined";
    }
    log("getEwio2ConfigData(): send to backend WS, iotype: " + iotype + "; host: " + configNodeData.data.host + "; prevIoPort: " + prevIoPort);
    const getEwio2ConfigurationDataPromise = new Promise((resolve, reject) => {
        if (!getConfigLocked) {
            getConfigLocked = true;
            let requestUrl = "get/ewio2/configdata/" + iotype + "/" + prevIoPort + "/" + nodeId + "/";
            if (counterAddr) {
                requestUrl += counterAddr;
            }
            else {
                requestUrl += "none";
            }
            $.post(requestUrl , configNodeData, function(data, textStatus) {
                getConfigLocked = false;
                resolve();
            })
            .fail(function(jqXHR, textStatus) {
                getConfigLocked = false;
                // enable all html elements, except IO ports (nothing is selectable on error)
                enableHtmlElements(true);
                showConnectionError(nodeId);
                reject(textStatus);
            })
        }
    });
    return getEwio2ConfigurationDataPromise;
}

/**
 * Sends the request with all data as content to Node-RED runtime, which closes and deletes the websocket.
 * @memberof BackendConnection
 * @param {Object} configNodeData - Object with configuration node ID,  host, user (optional), pw (optional) and encryption flag, used as key for ewio2Connections object. Optional values may be overwritten by Node-RED runtime.
 * @param {string} nodeId - Identification of the node, to get the error message.
 * @return {Promise} Was the websocket closed successfully (resolve).
 */
function closeDeleteWebsocket(configNodeData, nodeId) {
    log("close delete websocket frontend reached");
    const closeDeleteWsPromise = new Promise((resolve, reject) => {
        $.post("put/ewio2/closeDeleteWebsocket", configNodeData, function(data, textStatus) {
            resolve();
        })
        .fail(function(jqXHR, textStatus) {
            showConnectionError(nodeId);
            reject(textStatus);
        })
    });
    return closeDeleteWsPromise;
}

/**
 * Sends the request with all data as content to Node-RED runtime, to sent a new analag in configuration for the given IO port.
 * @memberof BackendConnection
 * @param {Object} configNodeData - Object with configuration node ID,  host, user (optional), pw (optional) and encryption flag, used as key for ewio2Connections object. Optional values may be overwritten by Node-RED runtime.
 * @param {string} configVal - Value which should be set as new configuration for analog input.
 * @param {string} ioPort - Combinate of port ((extension) module) and address, stringified with config node ID and host (e.g. {"nodeId":"75e235318e89127f","host":"ewio2device","addr":"02_0"}).
 * @param {string} nodeId - Identification of the node, which sets analog input configuration.
 * @return {Promise} Was the analog input configuration set successfully (resolve).
 */
function setAiConfig(configNodeData, configVal, ioPort, nodeId) {
    log("setAiConfig fct frontend reached");
    const setAiConfigPromise = new Promise((resolve, reject) => {
        $.post("put/ewio2/aiConfig/" + configVal + "/" + ioPort + "/" + nodeId, configNodeData, function(data, textStatus) {
            resolve();
        })
        .fail(function(jqXHR, textStatus) {
            showConnectionError(nodeId);
            reject(textStatus);
        })
    });
    return setAiConfigPromise;
}

/**
 * Gets the noConnection error message and shows it in configuration menu.
 * @memberof BackendConnection
 * @param {string} nodeId - Identification of the node, to get the error message.
 */
function showConnectionError(nodeId) {
    const selectedNode = RED.nodes.node(nodeId);
    var errorString = selectedNode._("@metz-connect/node-red-ewio2/ewio2:status.noConnection");
    $('#label-error-status').text(errorString);
    $('#section-error-status').show();
}
