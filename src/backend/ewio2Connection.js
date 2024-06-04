/**
 * @file Library used by Node-RED to establish connection to EWIO2 (via REST API) and get / set IO data via websocket.
 * @author Metz Connect
 */

/**
 * Config namespace.
 * @namespace Ewio2Connection
 */

const Ewio2Connection = require("./ewio2ConnObj");
const {log} = require("./general");

/**
 * Stores all EWIO2 connection objects in an object / map. Uses configuration node ID,  host, user, pw and encryption flag as key.
 * @memberof Ewio2Connection
 * @type {Object}
 */
var ewio2Connections = {};

/**
 * Decide wheter to use frontend, backend data or a combination of backend data and frontend data to establish a connection to EWIO2.
 * Backend data may be overwritten by frontend data, if customer updated user data. This combination of user data is used while configuration menu is open and flows not yet deployed.
 * @memberof Ewio2Connection
 * @param {Object} configNode - EWIO2 configuration node.
 * @param {Object} frontendData - received msg data.
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 * @param {string} configurationNodeId - Identification of the EWIO2 configuration node.
 * @return {Object} Object in JSON structure with configNodeId, host, user, pw and encryption-flag keys.
 */
function updateUserData(configNode, frontendData, RED, configurationNodeId) {
    const MD5 = require("crypto-js/md5");
    const {pubSub} = require("./general")

    let configNodeId = "";
    let nodeId = "";
    let host = "";
    let user = "";
    let pw = "";
    let enc = "";
    const node = configNode;

    // Node-RED runtime data available (backend)
    if (configNode) {
        configNodeId = configNode.id;
        host = configNode.host;
        user = configNode.credentials.username;
        pw = configNode.credentials.password;
        enc = configNode.encryption;
        log(node, 'backend data: ' + configNodeId + ' - ' + host + ' - ' + user + ' - ' + pw + ' - ' + enc);
    }
    // Node-RED editor data available (frontend). Overwrite backend data
    if (frontendData.configNodeId && frontendData.nodeId && frontendData.host && frontendData.enc) {
        configNodeId = frontendData.configNodeId;
        nodeId = frontendData.nodeId;
        host = frontendData.host;
        if (frontendData.user) {
            user = frontendData.user;
        }
        // use frontend password only if it is valid
        if (frontendData.pw != "__PWRD__" && frontendData.pw != undefined) {
            pw = frontendData.pw;
        }
        // convert encryption flag to bool
        enc = (frontendData.enc === "true");
        log(node, 'frontend data: ' + frontendData.configNodeId + ' - ' + frontendData.nodeId + ' - ' + frontendData.host + ' - ' + frontendData.user + ' - ' + frontendData.pw + ' - ' + frontendData.enc);
    }
    // one or more of the parameters missing
    if (!configNodeId || !host || !user || !pw) {
        log(node, 'updateUserData fct error: ' + RED._("status.notAuthorized"));
        pubSub.publish("show-status", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.notAuthorized", "configNodeId": configurationNodeId});
        RED.comms.publish("publish/ewio2/error/" + configurationNodeId, {code: ("status.notAuthorized")});
        return 200;
    }

    log(node, "configNodeId: " + configNodeId);
    log(node, "nodeId: " + nodeId);
    log(node, 'host: ' + host);
    log(node, 'user: ' + user);
    log(node, 'pw: ' + pw);
    log(node, 'enc: ' + enc);
    pw = MD5(pw);
    return {configNodeId: configNodeId, nodeId: nodeId, host: host, user: user, pw: pw, enc: enc};
}

/**
 * Request IO data from EWIO2 and publish them to Node-RED frontend.
 * When config data are requested, first all currently available values (of ioType) are deleted, to request them once more in nested function.
 * Connects again to EWIO2 and requests config values, to be able to handle for example connected / disconnected extension modules. 
 * Puslish all known values of ioType (stored in connection object) to Node-RED frontend.
 * @memberof Ewio2Connection
 * @param {Object} keyEwio2Data - Object with configuration node ID,  host, user, pw and encryption flag, used as key for ewio2Connections object.
 * @param {string} ioType - Which type of IO should be get (e.g. "do", "ao").
 * @param {string} prevIoPort - The last selected element of the port dropdown. Used to re-select again, after new data are received.
 * @param {string} counterId - ID of the counter for which datapoints are requested (only valid for datapoints, otherwise "none").
 * @param {string} nodeId - Identification of the node, which requests EWIO2 IO data.
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 * @param {Object} tlsConfig - TLS config data object, to establish a encrypted connection
 */
async function getConfigData(keyEwio2Data, ioType, prevIoPort, counterId, nodeId, RED, tlsConfig) {
    const node = RED.nodes.getNode(keyEwio2Data.configNodeId);
    log(node, 'getConfigData() reached; prevIoPort: ' + prevIoPort);
    // try to load connection object (if existing) and delete all values of ioType, to request them once more when connecting to EWIO2
    if (ewio2Connections[JSON.stringify(keyEwio2Data)]) {
        const connDeleteValues = ewio2Connections[JSON.stringify(keyEwio2Data)]["connObj"];
        if (connDeleteValues) {
            connDeleteValues.deleteAllStoredValues(ioType);
        }
    }
    let conn = await initConnectionToEwio2(keyEwio2Data, ioType, prevIoPort, nodeId, counterId, RED, tlsConfig, true);
    if (conn) {
        let publishedIoCntr = 0;
        let ioTypeToCheck = ioType + "®";
        if (ioType === "datapoints" && counterId !== "none") {
            ioTypeToCheck += counterId;
        }
        for (ioKey in conn.values) {
            if (conn.values.hasOwnProperty(ioKey) && ioKey.toString().startsWith(ioTypeToCheck)) {
                conn.publishIoPortStatus(conn.values[ioKey], RED, false, false);
                publishedIoCntr++;
            }
        }
        if (ioType === "counter" || ioType === "datapoints") {
            // no counter available
            if (ioType === "counter" && publishedIoCntr === 0) {
                // only publish no counter available error, if websocket connection is available and established (1 = open)
                if (conn.ws && conn.ws.readyState === 1) {
                    RED.comms.publish("publish/ewio2/error/" + conn.configNodeId, {code: ("status.noCounter")});
                }
            }
            RED.comms.publish("publish/ewio2/config/done", ioType);
        }
        // reset IO port after publishing data to Node-RED frontend and backend, to avoid that user selected port in dropdown is overwritten by livedata of another port
        conn.requestedIoPort = undefined;
        // start livedata channel
        if (conn.ws) {
            if (ioType !== "counter") {
                // datapoints, for example: get®livedata®datapoints®3 (counter-ID 3)
                if (ioType === "datapoints") {
                    await conn.sendWsMessage("get®livedata®" + ioTypeToCheck, RED);
                }
                // IOs, for example: get®livedata®do
                else {
                    await conn.sendWsMessage("get®livedata®" + ioType, RED);
                }
            }
        }
    }
}



/**
 * Connects to EWIO2 (if connection not yet established) and retrieves all values of ioType or counter values.
 * When connection to EWIO2 is established, search for value of requested port in connection object and return this value.
 * @memberof Ewio2Connection
 * @param {Object} keyEwio2Data - Object with configuration node ID,  host, user, pw and encryption flag, used as key for ewio2Connections object.
 * @param {string} ioType - Which type of IO should be get (e.g. "do", "ao").
 * @param {string} ioPortAddr - Combinate of port ((extension) module) and address, stringified with config node ID and host (e.g. {"nodeId":"75e235318e89127f","host":"ewio2device","addr":"02_0"}).
 * @param {string} nodeId - Identification of the node, which requests EWIO2 IO data.
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 * @param {Object} tlsConfig - TLS config data object, to establish a encrypted connection.
 * @return {number} The value which was retrieved from EWIO2.
 */
async function getValue(keyEwio2Data, ioType, ioPortAddr, nodeId, RED, tlsConfig) {
    const node = RED.nodes.getNode(keyEwio2Data.configNodeId);
    log(node, 'getValue fct reached; type: ' + ioType + '; port: ' + ioPortAddr);
    let counterId = "none";
    if (ioPortAddr && ioType === "datapoints") {
        counterId = JSON.parse(ioPortAddr).cntr;
    }
    let conn = await initConnectionToEwio2(keyEwio2Data, ioType, ioPortAddr, nodeId, counterId, RED, tlsConfig, false);
    if (ioType === "measurements") {
        return conn;
    }
    else {
        // reset IO port immediately after connection is established (before publishing data to Node-RED frontend and backend), to avoid that user selected port in dropdown is overwritten by livedata of another port
        conn.requestedIoPort = undefined;
        if (conn) {
            let ioTypeToCheck = ioType + "®";
            let ioTypeToFit = ioType + "®";
            if (ioPortAddr) {
                // create temp variables of ioPort
                const ioPortObj = JSON.parse(ioPortAddr);
                if (ioType === "datapoints" && counterId !== "none") {
                    ioTypeToCheck += counterId + "®";
                    ioTypeToFit += ioPortObj.cntr + "®" + ioPortObj.dp;
                }
                else {
                    ioTypeToFit += ioPortObj.addr;
                }
                // publish value of ioPort to Node-RED frontend and backend
                for (ioKey in conn.values) {
                    if (conn.values.hasOwnProperty(ioKey) && ioKey.toString().startsWith(ioTypeToCheck)) {
                        if (ioKey === ioTypeToFit) {
                            // set Bit3: value was requested from node (not published via livedata)
                            conn.values[ioKey].updatedInput |= 0x08;
                            conn.publishIoPortStatus(conn.values[ioKey], RED, true, true);
                        }
                    }
                }
                // start livedata channel and register digital input port, digital output port or datapoint for livedata updates
                if (conn.ws) {
                    if (ioType === "di" || ioType === "ai" || (ioType === "datapoints" && counterId !== "none")) {
                        await conn.sendWsMessage("get®livedata®" + ioTypeToFit, RED);
                    }
                }
            }
        }
    }
}

/**
 * Connects to EWOI2 (if connection not yet established) and sets a value to an output pin (digital or analog).
 * @memberof Ewio2Connection
 * @param {Object} keyEwio2Data - Object with configuration node ID,  host, user, pw and encryption flag, used as key for ewio2Connections object.
 * @param {number} value - Setpoint value for the output pin.
 * @param {string} ioType - Which type of IO should be set (e.g. "do", "ao").
 * @param {string} ioPortAddr - Combinate of port ((extension) module) and address, stringified with config node ID and host (e.g. {"nodeId":"75e235318e89127f","host":"ewio2device","addr":"02_0"}).
 * @param {string} nodeId - Identification of the node, which requests EWIO2 IO data.
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 * @param {string} command - command to send to EWIO2 (e.g. setValue or setS0).
 * @param {Object} tlsConfig - TLS config data object, to establish a encrypted connection
 */
async function setValue(keyEwio2Data, value, ioType, ioPortAddr, nodeId, RED, command, tlsConfig) {
    const node = RED.nodes.getNode(keyEwio2Data.configNodeId);
    let receivedVal;
    log(node, 'setValue fct reached ' + nodeId);
    let conn = await initConnectionToEwio2(keyEwio2Data, ioType, ioPortAddr, nodeId, "none", RED, tlsConfig, false);
    // reset IO port immediately after connection is established (before publishing data to Node-RED frontend and backend), to avoid that user selected port in dropdown is overwritten by livedata of another port
    conn.requestedIoPort = undefined;
    if (conn.ws && conn.ws.readyState === 1) {
        receivedVal = await conn.sendWsMessage("put®config®" + ioType + "®" + JSON.parse(ioPortAddr).addr + "®" + command + "®" + value, RED);
        log(node, 'setValue fct msg sent, receivedVal: ' + receivedVal);
    }
    return receivedVal;
}

/**
 * Establishes connection (if not yet existing) to EWIO2.
 * Adds and removes nodes from the registeredNodes array.
 * Starts websocket communication with EWIO2.
 * @memberof Ewio2Connection
 * @param {Object} keyEwio2Data - Object with configuration node ID,  host, user, pw and encryption flag, used as key for ewio2Connections object.
 * @param {string} ioType - Which type of IO should be get or set (e.g. "do", "ao").
 * @param {string} ioPortAddr - Combinate of port ((extension) module) and address, stringified with config node ID and host (e.g. {"nodeId":"75e235318e89127f","host":"ewio2device","addr":"02_0"}).
 * @param {string} nodeId - Identification of the node, which requests EWIO2 IO data.
 * @param {string} counterId - ID of the counter for which datapoints are requested (only valid for datapoints, otherwise "none").
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 * @param {Object} tlsConfig - TLS config data object, to establish a encrypted connection
 * @param {bool} generalLivedataForConfigMenu - Flag that indicates, that connection is established from configMenu (open separate websocket connection)
 */
async function initConnectionToEwio2(keyEwio2Data, ioType, ioPortAddr, nodeId, counterId, RED, tlsConfig, generalLivedataForConfigMenu) {
    let conn;
    const node = RED.nodes.getNode(keyEwio2Data.configNodeId);
    conn = await connectToEwio2(keyEwio2Data, ioType, ioPortAddr, nodeId, RED, tlsConfig, generalLivedataForConfigMenu); // Eclipse shows 'await' warning due to jsdoc @return comment
    if (conn.ws && conn.ws.readyState === 1) {
        log(node, 'initConnectionToEwio2 fct connection established');
        // register node which is connected with EWIO2
        log(node, 'register node: ' + nodeId);
        conn.registeredNodes.add(nodeId);
        log(node, 'registeredNodes: ' + new Array(...conn.registeredNodes).join(' '));
        // only close other "pending" / not anymore used websocket connections (established from config menu), when another config menu is opened
        // avoids that nodes that are running in flow, close connections from config menu (with their livedata)
        if(keyEwio2Data.nodeId) {
            handleRegisteredNodes(conn, nodeId, RED);
        }
        await getIoTypeDataAndStartLivedata(keyEwio2Data, ioType, counterId, RED);
        log(node, 'initConnectionToEwio2 fct got IO type data and started livedata');
    }
    return conn;
}

/**
 * Establishes connection to EWIO2.
 * Creates a connection object (if not yet available) and stores it in ewio2Connections map.
 * Creates and stores a promise for every connection establishment. If connection is established, all promises are resolved.
 * @memberof Ewio2Connection
 * @param {Object} keyEwio2Data - Object with configuration node ID,  host, user, pw and encryption flag, used as key for ewio2Connections object.
 * @param {string} ioType - Which type of IO should be get or set set (e.g. "do", "ao").
 * @param {string} prevIoPort - The last selected element of the port dropdown. Used to re-select again, after new data are received.
 * @param {string} nodeId - Identification of the node, which requests EWIO2 IO data.
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 * @param {Object} tlsConfig - TLS config data object, to establish a encrypted connection
 * @param {bool} generalLivedataForConfigMenu - Flag that indicates, that connection is established from configMenu (open separate websocket connection)
 * @return {Promise} Promise for establishing connection.
 */
function connectToEwio2(keyEwio2Data, ioType, prevIoPort, nodeId, RED, tlsConfig, generalLivedataForConfigMenu) {
    const node = RED.nodes.getNode(keyEwio2Data.configNodeId);
    log(node, 'connectToEwio2 fct reached; ioType: ' + ioType + '; nodeId: ' + nodeId);
    let ewioConnection = ewio2Connections[JSON.stringify(keyEwio2Data)];

    if (ewioConnection) {
        // create and add connObj (if it is not yet existing or if flag is set) to exiting ewio2Connections map entry
        if (!ewioConnection["connObj"] || generalLivedataForConfigMenu) {
            const conn = new Ewio2Connection(keyEwio2Data, ioType, prevIoPort, tlsConfig, generalLivedataForConfigMenu, RED);
            ewio2Connections[JSON.stringify(keyEwio2Data)]["connObj"] = conn;
        }
    }
    else {
        // create ewio2Connections map entry, create and add connObj to just created ewio2Connections map entry
        const conn = new Ewio2Connection(keyEwio2Data, ioType, prevIoPort, tlsConfig, generalLivedataForConfigMenu, RED);
        ewio2Connections[JSON.stringify(keyEwio2Data)] = {"connObj": conn};
    }
    // update IO type
    ewio2Connections[JSON.stringify(keyEwio2Data)]["connObj"].requestedIoType = ioType;
    // update IO port
    ewio2Connections[JSON.stringify(keyEwio2Data)]["connObj"].requestedIoPort = prevIoPort;
    const conn = ewio2Connections[JSON.stringify(keyEwio2Data)]["connObj"];
    var connectToEwio2Promise;
    // no websocket available or websocket not connected
    if (!conn.ws || conn.ws.readyState > 1) {
        // no connection promise available --> store resolve and reject function (to be resolved when REST API connection is established and first websocket response received)
        if (conn.connPromises.length === 0) {
            log(node, 'connectToEwio2, add promise for first connection');
            connectToEwio2Promise = new Promise(async (resolve, reject) => {
                conn.connPromises.push({resolve: resolve, reject: reject});
                log(node, 'ws NOT yet connected');
                await conn.establishConnection(RED);
            });
        }
        // connection promise (for this connection (conn)) already pending --> store resolve and reject function of promise for later resolve / reject
        else {
            log(node, 'connectToEwio2, add promise for further connection');
            connectToEwio2Promise = new Promise((resolve, reject) => {
                conn.connPromises.push({resolve: resolve, reject: reject});
            });
        }
    }
    else {
        return conn;
    }
    return connectToEwio2Promise;
}

/**
 * Registers node (which wants to connect to EWIO2) to registeredNodes.
 * Not needed connections (no node has registered to this connection) are closed.
 * @memberof Ewio2Connection
 * @param {Object} conn - Connection object
 * @param {string} nodeId - Identification of the node, which requests EWIO2 IO data.
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 */
function handleRegisteredNodes(conn, nodeId, RED) {
    const node = RED.nodes.getNode(conn.configNodeId);
    // deregister not needed nodes from EWIO2 connections
    log(node, 'STORED CONNECTIONS');
    // check all connections of ewio2Connections map
    // check in descending order, to savely delete connection (deregister node)
    for (var ewio2Conn = Object.keys(ewio2Connections).length - 1; ewio2Conn >= 0; ewio2Conn--) {
        let connKey = Object.keys(ewio2Connections)[ewio2Conn];
        const connObj = ewio2Connections[connKey]["connObj"];
        connKey = JSON.parse(connKey);
        log(node, 'connection: configNodeId: ' + connKey.configNodeId + '\thost: ' + connKey.host + '\tuser: ' + connKey.user);
        if (connObj && connObj.ws && connObj.ws.readyState) {
            log(node, 'ws ready state: ' + connObj.ws.readyState);
            if (connObj.registeredNodes.size) {
                log(node, 'registered nodes: ' + connObj.registeredNodes.size);
                // check all registered nodes, if they are still available and used
                for (const nodeItem of connObj.registeredNodes) {
                    // connection that was opened for config menu and not for the current node / config node (for which the connection was established above)
                    if (connObj.generalLivedataConfigMenu && nodeItem != nodeId) {
                        deregisterNode(undefined, connKey, nodeItem, RED);
                    }
                }
            }
        }
        log(node, '');
    }
}

/**
 * Requests values of ioType from EWIO2 and start livedata channel.
 * Request is only done if data of ioType are not yet available / stored in connection object.
 * Creates and stores a promise (according ioType) for every request. If respone or timeout, all promises are resolved.
 * @memberof Ewio2Connection
 * @param {Object} keyEwio2Data - Object with configuration node ID,  host, user, pw and encryption flag, used as key for ewio2Connections object.
 * @param {string} ioType - Which type of IO should be get or get or set (e.g. "do", "ao").
 * @param {string} counterId - ID of the counter for which datapoints are requested (only valid for datapoints, otherwise "none").
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 * @return {Promise} Promise for get values and start livedata channel.
 */
function getIoTypeDataAndStartLivedata(keyEwio2Data, ioType, counterId, RED) {
    const node = RED.nodes.getNode(keyEwio2Data.configNodeId);
    log(node, 'getIoTypeDataAndStartLivedata fct reached');
    const conn = ewio2Connections[JSON.stringify(keyEwio2Data)]["connObj"];
    if (conn) {
        try {
            var getIoTypeAndStartLivedataPromise;
            // data of IO type not yet stored in connection objec
            let ioTypeToCheck = ioType;
            if (ioType === "datapoints" && counterId !== "none") {
                ioTypeToCheck += "®" + counterId;
            }
            // values of ioType not yet known --> request values
            if (!conn.isIoTypeValueKnown(ioTypeToCheck)) {
                // not getPromise for ioType available --> store resolve and reject function of getPromise and enqueue websocket msg
                if (!conn.getPromises[ioTypeToCheck] || conn.getPromises[ioTypeToCheck].length === 0) {
                    log(node, 'getIoTypeDataAndStartLivedata, add promise for first IO data');
                    getIoTypeAndStartLivedataPromise = new Promise(async (resolve, reject) => {
                        if (!conn.getPromises[ioTypeToCheck]) {
                            // create ioType category (of getPromises)
                            conn.getPromises[ioTypeToCheck] = [];
                        }
                        conn.getPromises[ioTypeToCheck].push({resolve: resolve, reject: reject});
                        log(node, 'no IO type data available and livedata not started');
                        let portIndicator = "all";
                        // datapoints: request given counter ID; all other (DI, AI, DO, AO, counter): request "all"
                        if (ioType === "datapoints" && counterId !== "none") {
                            portIndicator = counterId;
                        }
                        // request "get®config®<ioType>®all", to get all IO data of ioType
                        await conn.sendWsMessage("get®config®" + ioType + "®" + portIndicator, RED);
                        conn.resolveAllStoredGetPromises(ioTypeToCheck, RED);
                    });
                }
                // getPromises to request ioType values already available --> only store resolve and reject function
                else {
                    log(node, 'getIoTypeDataAndStartLivedata, add promise for further IO data');
                    getIoTypeAndStartLivedataPromise = new Promise((resolve, reject) => {
                        if (!conn.getPromises[ioTypeToCheck]) {
                            conn.getPromises[ioTypeToCheck] = [];
                        }
                        conn.getPromises[ioTypeToCheck].push({resolve: resolve, reject: reject});
                    });
                }
            }
        }
        catch (error) {
            log(node, 'getIoTypeDataAndStartLivedata fct error: ' + error);
        }
    }
    return getIoTypeAndStartLivedataPromise;
}

 /**
 * Closes websocket connection and deletes complete connection entry from ewio2Connections map.
 * @memberof Ewio2Connection
 * @param {function} callback - If available, this function is executed after closeDeleteWebsocket functio was done.
 * @param {string} keyEwio2Data - Object with configuration node ID,  host, user, pw and encryption flag, used as key for ewio2Connections object.
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 */
function closeDeleteWebsocket(callback, keyEwio2Data, RED) {
    const node = RED.nodes.getNode(keyEwio2Data.configNodeId);
    log(node, 'closeDeleteWebsocket fct reached');
    let conn;
    if (ewio2Connections[JSON.stringify(keyEwio2Data)]) {
        conn = ewio2Connections[JSON.stringify(keyEwio2Data)]["connObj"];
    }
    if (conn) {
        conn.closeAndDeleteWs(RED);
        delete ewio2Connections[JSON.stringify(keyEwio2Data)];
    }
    if (callback) {
        callback();
    }
    log(node, 'closeDeleteWebsocket fct done');
}

/**
 * Deletes the given node Id from registerd nodes (for connection to EWIO2).
 * If no other node is registerd to this EWIO2 websocket connection, the websocket is closed.
 * @memberof Ewio2Connection
 * @param {function} callback - If available, this function is executed after closeDeleteWebsocket functio was done.
 * @param {string} keyEwio2Data - Object with configuration node ID,  host, user, pw and encryption flag, used as key for ewio2Connections object.
 * @param {string} nodeId - Identification of the node, which should be de-registered.
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 */
function deregisterNode(callback, keyEwio2Data, nodeId, RED) {
    const node = RED.nodes.getNode(keyEwio2Data.configNodeId);
    log(node, 'deregisterNode fct reached');
    let conn;
    if (ewio2Connections[JSON.stringify(keyEwio2Data)]) {
        conn = ewio2Connections[JSON.stringify(keyEwio2Data)]["connObj"];
    }
    if (conn) {
        const wsDeleted = conn.deregisterNodeFromConnObj(nodeId, RED);
        if (wsDeleted) {
            delete ewio2Connections[JSON.stringify(keyEwio2Data)];
        }
    }
    if (callback) {
        callback();
    }
    log(node, 'deregisterNode fct done');
}

module.exports = { updateUserData, getValue, setValue, getConfigData, closeDeleteWebsocket, deregisterNode };

