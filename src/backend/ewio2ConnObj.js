/**
 * @file Library used by Node-RED to handle connection object.
 * @author Metz Connect
 */

/**
 * Config namespace.
 * @namespace ewio2ConnObj
 */

const ConnectedState = require("./connectedState");
const {log, pubSub} = require("./general");

/**
 * Timeout for websocket messages in milli-seconds
 * @memberof Ewio2ConnObj
 * @type {int}
 */
const wsMsgTimeout = 10000;

class Ewio2Connection {
    configNodeId;
    host;
    user;
    pw;
    enc;
    tlsConfig;
    generalLivedataConfigMenu;
    requestedIoType;
    requestedIoPort;
    connPromises;
    getPromises;
    wsPromise;
    tan;
    ws;
    connState;
    values;
    registeredNodes;
    timeoutId;

    constructor(identifier, ioType, ioPort, tlsConfig, generalLivedataForConfigMenu, RED) {
        this.configNodeId = identifier.configNodeId;
        this.host = identifier.host;
        this.user = identifier.user;
        this.pw = identifier.pw;
        this.enc = identifier.enc;
        this.tlsConfig = {};
        this.generalLivedataConfigMenu = generalLivedataForConfigMenu;
        // set encryption values to connection object, if encryption is selected by customer
        if (this.enc && tlsConfig) {
            // decide whether to use backend data or frontend data
            let tlsBackendNode = RED.nodes.getNode(tlsConfig.tlsConfigId);
            // try to use backend data (if available)
            if (tlsBackendNode) {
                this.tlsConfig.tlsConfigId = tlsBackendNode.tlsConfigId;
                this.tlsConfig.credentials = tlsBackendNode.credentials;
                this.tlsConfig.verifyservercert = (tlsBackendNode.verifyservercert === "true"); // convert to bool
                this.tlsConfig.servername = tlsBackendNode.servername;
                this.tlsConfig.alpnprotocol = tlsBackendNode.alpnprotocol;
            }
            // overwrite backend data with frontend data (if available). Frontend data may be "newer" than backend data
            if (tlsConfig) {
                this.tlsConfig.tlsConfigId = tlsConfig.tlsConfigId;
                if (tlsConfig.credentials) {
                    this.tlsConfig.credentials = tlsConfig.credentials;
                }
                this.tlsConfig.verifyservercert = (tlsConfig.verifyservercert === "true"); // convert to bool
                this.tlsConfig.servername = tlsConfig.servername;
                this.tlsConfig.alpnprotocol = tlsConfig.alpnprotocol;
            }
        }
        this.connPromises = [];
        this.getPromises = [];
        this.requestedIoType = ioType;
        this.requestedIoPort = ioPort;
        this.connState = ConnectedState.IDLE;
        this.values = {};
        this.registeredNodes = new Set();
    }

/**
 * Establishes connection to EWIO2.
 * Connects to REST API, to get session ID and establishes connnection to EWIO2 via websocket protocol.
 * Handles errors and outputs error messages to Node-RED frontend and Node-RED backend.
 * @memberof Ewio2ConnObj
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 */
    async establishConnection(RED) {
        const node = RED.nodes.getNode(this.configNodeId);
        try {
            var tan = await this.#connectRestApi(RED);
            // set the received TAN
            this.tan = tan;
            log(node, 'connect REST API done for: ' + this.host + ', TAN: ' + this.tan)
            await this.#connectWebsocket(RED);
            log(node, 'connect websocket done');
        }
        catch (error) {
            log(node, 'establishConnection fct error: ' + error);
            this.closeAndDeleteWs(RED);
            let connectError = error.code;
            let errorMsg = "";
            // this errors are available with their name in translation files
            if (error === "notAuthorized" || error === "missingCertificate" || error === "tlsConfigMissing" ) {
                connectError = error;
            }
            // Node.JS error see: https://betterstack.com/community/guides/scaling-nodejs/nodejs-errors/
            //                  addr/endpoint/service not reachable  wrong IP???                       wrong network?                   DNS error (e.g. EWIO2 host "10.10.x.y" OR EWIO2 host "myEWIO2" (which is not in /etc/hosts) and Node-RED running on EWIO2)
            //                                                                                                                      DNS loopup timeout (e.g. EWIO2 host "myEWIO2" (which is not in /etc/hosts) and Node-RED running on PC OR error in /etc/hosts)
            else if (connectError === "ECONNREFUSED" || connectError === "EHOSTUNREACH" || connectError === "ENETUNREACH" || connectError === "ENOTFOUND"  || connectError === "EAI_AGAIN") {
                errorMsg = connectError;
                connectError = "notReachable";
            }
            //                         timeout                         connection closed (e.g. changed EWIO2s subnet, e.g. from 192.168.a.b to 10.10.x.y)
            else if (connectError === "ETIMEDOUT" || connectError === "ECONNRESET") {
                errorMsg = connectError;
                connectError = "timeout";
            }
            //                        e.g. EWIO2 host "23436547546345345"
            else if (connectError === "ERR_INVALID_URL") {
                connectError = "invalidURL";
            }
            else if (connectError === "ENOENT") {
                connectError = "missingCertificate"
            }
            else if (connectError === "DEPTH_ZERO_SELF_SIGNED_CERT") {
                connectError = "selfSignedCertificate";
            }
            else if (connectError === "ERR_TLS_CERT_ALTNAME_INVALID") {
                errorMsg = error.message;
                connectError = "invalidCertificateAltname";
            }
            else {
                errorMsg = connectError || error;
                connectError = "unhandeledError";
            }
            const elem = {ioType: "", address: this.requestedIoPort, value: "ERROR", error: connectError, errorMsg: errorMsg};
            this.publishIoPortStatus(elem, RED, true, false);
            this.#resolveAllStoredConnPromises(RED);
            this.#resolveNextStoredWsPromise(RED);
        }
    }

/**
 * Send message to EWIO2 via websocket protocol.
 * Waits until no predecessor message is in "waiting for response" state.
 * Creates and stores a promise with timeout when websocket message is send to EWIO2.
 * On timeout error is published, connection is closed, already stored values are deleted and promises are resovled to a secure state.
 * @memberof Ewio2ConnObj
 * @param {string} msg - Message which is send to EWIO2 via websocket.
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 * @return {string} Value which was setted at EWIO2.
 */
    async sendWsMessage(msg, RED) {
        const connObj = this;
        const node = RED.nodes.getNode(this.configNodeId);
        // "queue" that waits until wsPromise for previous websocket msg was resolved
        while (this.wsPromise) {
            log(node, 'sendWsMessage, wait for predecessor msg');
            await this.wsPromise.promise;
            log(node, 'sendWsMessage, wait for predecessor msg done');
        }
        log(node, 'sendWsMessage, add promise for first msg');
        let wsPromiseResolveTemp;
        let wsPromiseRejectTemp;
        // create new wsPromise when websocket msg is send
        const wsPromiseTemp = new Promise((resolve, reject) => {
            wsPromiseResolveTemp = resolve;
            wsPromiseRejectTemp = reject;
            this.timeoutId = setTimeout(function(){
                log(node, "sendWsMessage timeout: " + msg);
                const elem = {ioType: "", address: this.requestedIoPort, value: "ERROR", error: "timeoutWsMsg"};
                connObj.publishIoPortStatus(elem, RED, true, false);
                connObj.closeAndDeleteWs(RED);
                connObj.deleteAllStoredValues();
                connObj.#resolveAllStoredConnPromises(RED);
                connObj.#resolveNextStoredWsPromise(RED);
            }, wsMsgTimeout);
            // check for existing websocket. If a msg gets a timeout, other pending msgs are not tried to send via closed websocket
            if (this.ws) {
                log(node, 'sendWsMessage: ' + msg);
                this.ws.send(msg);
            }
        });
        // store resolve function, reject function and promise itself as current wsPromise
        this.wsPromise = {resolve: wsPromiseResolveTemp, reject: wsPromiseRejectTemp, promise: wsPromiseTemp};
        log(node, 'sendWsMessage, wait for current msg');
        // wait until wsPromise msg is resolved (correct response received)
        const settedVal = await this.wsPromise.promise;
        log(node, 'sendWsMessage, wait for current msg done');
        return settedVal;
    }

/**
 * Establish REST API connection to EWIO, to request session-ID (TAN). Connection can be encrypted (https) or not (http).
 * @memberof Ewio2ConnObj
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 * @return {Promise} Connection status to EWIO2 REST API, resolve (with received TAN) or reject (with error).
 */
    #connectRestApi(RED) {
        const fs = require('fs');
        this.connState = ConnectedState.REST_API_CONNECTING;
        const node = RED.nodes.getNode(this.configNodeId);
        log(node, 'connectRestApi, host: ' + this.host);
        const connObj = this;
        var connectRestApiPromise = new Promise((resolve, reject) => {
            log(node, 'enc: ' + this.enc + "; type: " + typeof this.enc);
            // HTTPS
            if (this.enc) {
                // TLS config available (Object not empty)
                if (Object.keys(connObj.tlsConfig).length > 0) {
                    const https = require('https');
                    let opts = {
                        method: 'GET',
                        host: connObj.host,
                        port: 443,// 443 is default
                        path: "/cgi-bin/getParamFromServer.cgi?username=" + connObj.user + "&password=" + connObj.pw + "&type=single_id&module=login",
                        ca: connObj.tlsConfig.credentials.cadata,
                        rejectUnauthorized: connObj.tlsConfig.verifyservercert,
                        cert: connObj.tlsConfig.credentials.certdata,
                        key: connObj.tlsConfig.credentials.keydata,
                        passphrase: connObj.tlsConfig.credentials.passphrase,
                        servername: connObj.tlsConfig.servername,
                        ALPNProtocols: connObj.tlsConfig.alpnprotocol
                    };
                    log(node, 'port: ' + opts.port);
                    var reqHttps = https.request(opts, function(res){
                        res.on("data", function(data) {
                            connObj.connState = ConnectedState.REST_API_CONNECTED;
                            resolve(connObj.#calcTanMd5Hash(data, connObj.pw));
                        });
                    }).end();
                }
                // TLS config missing
                else {
                    log(node, "no TLS configuration available");
                    reject("tlsConfigMissing");
                }
                reqHttps.on("error", function(err) {
                    reject (err);
                });
            }
            // HTTP
            else {
                const http = require('http');
                const url = "http://" + this.host + "/cgi-bin/getParamFromServer.cgi?username=" + this.user + "&password=" + this.pw + "&type=single_id&module=login";
                log(node, 'url: ' + url);
                var req = http.get(url, function (response) {
                    response.on("data", function (data) {
                        connObj.connState = ConnectedState.REST_API_CONNECTED;
                        resolve(connObj.#calcTanMd5Hash(data, connObj.pw));
                    });
                });
                req.on("error", function(err) {
                    reject (err);
                });
            }
        });
        return connectRestApiPromise;
    }

/**
 * Calculates the REST API TAN.
 * @memberof Ewio2ConnObj
 * @param {Object} data - Received response from REST API.
 * @param {Object} pw - Hashed password for connection to EWIO2.
 * @return {string} Calculated TAN-MD5-Hash.
 */
    #calcTanMd5Hash(data, pw) {
        const sessionId = data.toString();
        const tanMd5Hash = pw + "1" + sessionId;
        return tanMd5Hash;
    }

/**
 * Establishes connection to ioManager websocket of EWIO2. Connection can be encrypted (wss) or not (ws).
 * This websocket connection is stored in connection object.
 * When websocket connection is established, TAN is sent to websocket, to start initialisation.
 * When a websocket message is received from EWIO2, the message handling start.
 * This contains send next request to EWIO2, handle / resolve promise or publish data to Node-RED frontend or backend.
 * @memberof Ewio2ConnObj
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 * @return {Promise} Resolved when TAN is sent and rejected on error.
 */
    #connectWebsocket(RED) {
        const node = RED.nodes.getNode(this.configNodeId);
        log(node, 'connectWebsocket, host: ' + this.host);
        const websocketPromise = new Promise((resolve, reject) => {
            const connObj = this;
            const WebSocket = require("ws");
            var ws;
            //const ewioConnection = ewio2Connections[JSON.stringify(keyEwio2Data)];
            if (this.enc) {
                // TLS config available (Object not empty)
                if (Object.keys(connObj.tlsConfig).length > 0) {
                    log(node, 'connectWebsocket(), to host: wss://' + this.host);
                    ws = new WebSocket("wss://" + this.host + "/iomanager", {
                        ca: connObj.tlsConfig.credentials.cadata,
                        rejectUnauthorized: connObj.tlsConfig.verifyservercert,
                        cert: connObj.tlsConfig.credentials.certdata,
                        key: connObj.tlsConfig.credentials.keydata,
                        passphrase: connObj.tlsConfig.credentials.passphrase,
                        servername: connObj.tlsConfig.servername,
                        ALPNProtocols: connObj.tlsConfig.alpnprotocol
                    });
                }
                // TLS config missing
                else {
                    log(node, "no TLS configuration available");
                    reject("tlsConfigMissing");
                }
            }
            else {
                log(node, 'connectWebsocket(), to host: ws://' + this.host);
                ws = new WebSocket("ws://" + this.host + "/iomanager");
            }
            this.ws = ws;
            this.ws.on("open", async function() {
                connObj.connState = ConnectedState.WEBSOCKET_OPEN;
                log(node, 'connectWebsocket fct to: ' + connObj.host + ' send tan: ' + "!" + connObj.tan);
                await connObj.sendWsMessage("!" + connObj.tan, RED);
                resolve();
            });
            this.ws.on("message", async function(data) {
                var strData = data.toString();
                log(node, 'onMessage: ' + strData + ' from: ' + connObj.host + ' (user: ' + connObj.user + ')');
                // authentication ok -> send message to EWIO2 which fits to current state
                if (strData == "read") {
                    // resolve all connection promises
                    connObj.#resolveAllStoredConnPromises(RED);
                    connObj.#resolveNextStoredWsPromise(RED);
                }
                // read initially all IOs of the given type --> open livedata channel
                else if (strData == "done") {
                    connObj.#resolveNextStoredWsPromise(RED);
                }
                // livedata channel opened -> resolve promise, to proceed execution
                else if (strData.startsWith("done®livedata®")) {
                    connObj.connState = ConnectedState.CONNECTED;
                    // resolve next wsPromse
                    connObj.#resolveNextStoredWsPromise(RED);
                }
                else if (strData.startsWith("do®") || strData.startsWith("di®") || strData.startsWith("ao®") || strData.startsWith("ai®")) {
                    const parts = strData.split("®");
                    const recvIoTypeAddr = parts[0] + "®" + parts[1];
                    // the msg must contain at least 7 elemtens (7 for e.g. setValue response; 8 for livedata (contains also moduleName))
                    if (parts.length >= 7) {
                        // response of setValue and setConfig (analog input config) have 7 elements, response of setS0 (pulse counter active) and setPC (pulse counter value) have 9 elements
                        if (parts.length === 7 || parts.length === 9) {
                            connObj.#resolveNextStoredWsPromise(RED, parts[2]);
                        }
                        // store received data in ewio2Connections map (ioType®address as key; e.g. "do®01_0")
                        // idx 0  1    2     3                                                       4        5           6          7
                        // DO: do®port®state®record®                                                 portname®description®manualMode®extensionModule , e.g. do®01_2®0®0®REL2 (21/22/24)®Light®0®MR-DIO4/2
                        // AO: ao®port®value®recordRange®                                            portname®description®manualMode®extensionModule , e.g. ao®03_5®®0®AO4 (4/C2)®®0®MR-AO4
                        // idx 0  1    2     3      4                5                6              7        8                      9
                        // DI: di®port®state®record®pulseCntrVisible®pulseCntrChecked®pulseCntrValue®portname®description®           extensionModule , e.g. di®03_2®0®0®1®0®0®DI4 (4/C1)®Door®MR-DIO4/2
                        // idx 0  1    2      3          4                                           5        6                      7
                        // AI: ai®port®value®recordRange®config®                                     portname®description®           extensionModule , e.g. ai®03_6®3.84®0®6®CI4 (I4/4-)®Poti®MR-CI4
                        let element;
                        // bitfield with 3 bits. All values can be changed!
                        // Bit 0: signal value changed
                        // Bit 1: pulse counter value changed
                        // Bit 2: pulse counter checked (activated) changed
                        let updatedSetting = 0;
                        // digital input
                        if (parts[0] === "di") {
                            let lastValue;
                            let lastPulseCntrValue;
                            let lastPulseCntrChecked;
                            if (connObj.values[recvIoTypeAddr]) {
                                // last value available in connection object
                                lastValue = connObj.values[recvIoTypeAddr].value;
                                // last pulse counter value available in connection object
                                lastPulseCntrValue = connObj.values[recvIoTypeAddr].pulseCntrValue;
                                // last pulse counter checked (activated) available in connection object
                                lastPulseCntrChecked = connObj.values[recvIoTypeAddr].pulseCntrChecked;
                            }
                            // only if value, pulse counter value or pulse counter checked (activated) has changed
                            if ((lastValue != parts[2]) || lastPulseCntrValue != parts[6] || lastPulseCntrChecked != parts[5]) {
                                element = {"ioType": parts[0], "address": parts[1], "value": parts[2], "record": parts[3], "pulseCntrVisible": parts[4], "pulseCntrChecked": parts[5], "pulseCntrValue": parts[6], "name": parts[7], "description": parts[8], "moduleName": parts[9]};
                                // signal value changed
                                if (lastValue != parts[2]) {
                                    updatedSetting += 1;
                                }
                                // pulse counter value changed
                                if (lastPulseCntrValue != parts[6]) {
                                    updatedSetting += 2;
                                }
                                // pulse counter checked (activated) changed
                                if (lastPulseCntrChecked != parts[5]) {
                                    updatedSetting += 4;
                                }
                            }
                        }
                        // analog input
                        else if (parts[0] === "ai") {
                            let lastValue;
                            let lastAiConfig;
                            if (connObj.values[recvIoTypeAddr]) {
                                // last value available in connection object
                                lastValue = connObj.values[recvIoTypeAddr].value;
                                // last analog input configuration available in connection object
                                lastAiConfig = connObj.values[recvIoTypeAddr].config;
                            }
                            // only if value or analog input configuration has changed
                            if ((lastValue != parts[2]) || (lastAiConfig != parts[4])) {
                                element = {"ioType": parts[0], "address": parts[1], "value": parts[2], "record": parts[3], "config": parts[4], "name": parts[5], "description": parts[6], "moduleName": parts[7]};
                                // value changed
                                if (lastValue != parts[2]) {
                                    updatedSetting += 1;
                                }
                                // analog input configuration changed
                                if (lastAiConfig != parts[4]) {
                                    updatedSetting += 2;
                                }
                            }
                        }
                        // digital output, analog output
                        else {
                            element = {"ioType": parts[0], "address": parts[1], "value": parts[2], "record": parts[3], "name": parts[4], "description": parts[5], "manualMode": parts[6], "moduleName": parts[7]};
                        }
                        // only if element is created (new data available)
                        if (element) {
                            connObj.values[recvIoTypeAddr] = element;
                            // set additional property, which is required by frontend, to decide if value or pulse counter value has changed
                            element["updatedInput"] = updatedSetting;
                            if (parts[2] === "ERROR") {
                                element["error"] = "portCommError";
                            } 
                            // only publish received livedata (no ws-setup promise (getPromise) available)
                            if (connObj.#noGetPromisePending(element.ioType)) {
                                connObj.publishIoPortStatus(element, RED, true, true);
                            }
                        }
                    }
                }
                // all "active" counters received
                else if (strData === "counter®config®done") {
                    RED.comms.publish("publish/ewio2/config/done", "counter");
                    connObj.#resolveNextStoredWsPromise(RED);
                }
                // receive "active" counter
                else if (strData.startsWith("counter®config")) {
                    const parts = strData.split("®");
                    // the msg must contain complete counter datasets
                    if (parts.length === 5) {
                        const counterElement = {"ioType": parts[0], "id": parts[2], "name": parts[3], "bus": parts[4]};
                        const recvCntrAddr = parts[0] + "®" + parts[2];
                        connObj.values[recvCntrAddr] = counterElement;
                        // only publish received livedata (no ws-setup promise (getPromise) available)
                        if (connObj.#noGetPromisePending(counterElement.ioType)) {
                            connObj.publishIoPortStatus(counterElement, RED, true, false);
                        }
                    }
                    // metering error received (no metering model)
                    else if (parts.length === 3) {
                        RED.comms.publish("publish/ewio2/error/" + connObj.configNodeId, {code: ("status." + parts[2])});
                    }
                }
                // all "active" datapoints received
                else if (strData === "datapoints®config®done") {
                    RED.comms.publish("publish/ewio2/config/done", "datapoints");
                    connObj.#resolveNextStoredWsPromise(RED);
                }
                // receive "active" datapoints
                else if (strData.startsWith("datapoints®config")) {
                    const parts = strData.split("®");
                    let datapointsElement = {};
                    // the msg must contain complete datapoints datasets
                    if (parts.length === 9) {
                        datapointsElement = {"ioType": parts[0], "counterId": parts[2], "id": parts[3], "name": parts[4], "range": parts[5], "timestamp": parts[6], "flags": parts[7], "value": parts[8], "source": "requested"};
                        const recvCntrDpAddr = parts[0] + "®" + parts[2] + "®" + parts[3];
                        connObj.values[recvCntrDpAddr] = datapointsElement;
                        // only publish received livedata (no ws-setup promise (getPromise) available)
                        if (connObj.#noGetPromisePending(datapointsElement.ioType)) {
                            connObj.publishIoPortStatus(datapointsElement, RED, true, false);
                        }
                    }
                    // no counter data available
                    else if (parts.length === 6) {
                        const elem = {ioType: "", address: connObj.requestedIoPort, value: "ERROR", error: "noData"};
                        connObj.publishIoPortStatus(elem, RED, true, false);
                    }
                }
                // received counter livedata value
                else if (strData.startsWith("datapoints®livedata®")) {
                    const parts = strData.split("®");
                    const recvCntrDpAddr = "datapoints®" + parts[2] + "®" + parts[3];
                    let storedRange = "";
                    let storedName = "";
                    // range and name are not updated via livedata!!!
                    if (connObj.values[recvCntrDpAddr]) {
                        storedRange = connObj.values[recvCntrDpAddr].range;
                        storedName = connObj.values[recvCntrDpAddr].name;
                    }
                    let datapointsElement = {};
                    if (parts.length === 7) {
                        datapointsElement = {"ioType": "datapoints", "counterId": parts[2], "id": parts[3], "name": storedName, "range": storedRange, "timestamp": parts[4], "flags": parts[5], "value": parts[6], source: "livedata"};
                    }
                    else if (parts.length === 8) {
                        datapointsElement = {"ioType": "datapoints", "counterId": parts[2], "id": parts[3], "name": storedName, "range": storedRange, "timestamp": parts[4], "flags": parts[5], "value": parts[6], "reason": parts[7], source: "livedata"};
                    }
                    if (datapointsElement) {
                        
                        connObj.values[recvCntrDpAddr] = datapointsElement;
                        connObj.publishIoPortStatus(datapointsElement, RED, true, true);
                    }
                }
                // check authorization
                else if (strData.startsWith("unauthorized")) {
                    connObj.ws.close();
                    // "notAuthorized" is the same name as in language files!!!
                    reject ("notAuthorized");
                }
                // check access rights (must be Operator or Administrator)
                else if (strData == "insufficientAccessRights") {
                    connObj.#resolveNextStoredWsPromise(RED);
                    // "insufficientAccessRights" is the same name as in language files!!!
                    pubSub.publish("show-status", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status." + strData, "configNodeId": connObj.configNodeId});
                }
                // check if bacnet server is running and digital OUT or analog OUT should be set (put®...®setValue®... command to EWIO2)
                else if (strData == "bacnetServerActive") {
                    connObj.#resolveNextStoredWsPromise(RED);
                    // "bacnetServerActive" is the same name as in language files!!!
                    pubSub.publish("show-status", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status." + strData, "configNodeId": connObj.configNodeId});
                }
            });
            this.ws.on("close", function() {
                log(node, 'websocket closed');
            });
            this.ws.on("error", function(error){
                log(node, 'onError connectWebsocket(): ' + error);
                //resolves.length = 0;
                reject (error);
            });
        });
        return websocketPromise;
    }

/**
 * Resolves all stored connection promises.
 * This is done if connection is established or when establishing connection fails (error already published in another function)
 * @memberof Ewio2ConnObj
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 */
    #resolveAllStoredConnPromises(RED) {
        const node = RED.nodes.getNode(this.configNodeId);
        log(node, "resolveAllStoredConnPromises: nr of conn promises: " + this.connPromises.length);
        var prom;
        // resolve all pending promises
        while (prom = this.connPromises.shift()) {
            log(node, "resolveAllStoredConnPromises: resolved connPromise");
            prom.resolve(this);
        }
    }

/**
 * Resolves all stored get value and start livedata channel promises.
 * @memberof Ewio2ConnObj
 * @param {string} ioType - Which type of IO should be get or set (e.g. "do", "ao").
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 */
    resolveAllStoredGetPromises(ioType, RED) {
        const node = RED.nodes.getNode(this.configNodeId);
        var prom;
        log(node, "resolveAllStoredGetPromises: nr of get promises: " + this.getPromises[ioType].length);
        // resolve all pending getPromises
        while (prom = this.getPromises[ioType].shift()) {
            log(node, "resolveAllStoredGetPromises: resolved getPromise!!!");
            prom.resolve();
        }
    }

/**
 * Resolves next stored websocket promise and cleares timeout, to deactivate timeout handing.
 * @memberof Ewio2ConnObj
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 * @param {string} setVal - Value which was setted to EWIO2 (only valid when setting value).
 */
    #resolveNextStoredWsPromise(RED, setVal) {
        const node = RED.nodes.getNode(this.configNodeId);
        var prom = this.wsPromise;
        // resolve next pending wsPromises
        if (prom) {
            // response received or error --> clear timeout
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
            log(node, "resolveNextStoredWsPromise: resolved wsPromise!!!");
            // reset wsPromise, to be able to store next "enqueued" (with while loop) wsPromise
            this.wsPromise = undefined;
            prom.resolve(setVal);
        }
    }

/**
 * Publishes the current status of IO port to frontend (RED.comms.publish) and to backend (pubSub.publish).
 * Status can either be successfully connected, manual mode active or an error status.
 * It is also possible to publish a value to a Node-RED node´s output ("send-value-...").
 * @memberof Ewio2ConnObj
 * @param {Object} element - IO port message which was received from EWIO2 or stored in ewio2Connections map.
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 * @param {bool} backendPublish - Flag that is set, if events to backend should be published.
 * @param {bool} sendInputPublish - Flag that is set, if input node (analog, digital) should send a msg to node output.
 */
    publishIoPortStatus(element, RED, backendPublish, sendInputPublish) {
        // add host, which is needed by frontend, to distinguish between values in dropdown
        element["host"] = this.host;
        let ioPort;
        if (element.ioType === "datapoints") {
            ioPort = {nodeId: this.configNodeId, host: this.host, dp: element.id, cntr: element.counterId};
        }
        else {
            ioPort = {nodeId: this.configNodeId, host: this.host, addr: element.address};
        }
        if (element.value === "ERROR" && element.error) {
            if (backendPublish) {
                if (element.error === "portCommError") {
                    pubSub.publish("show-status-" + element.ioType, {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status." + element.error, "configNodeId": this.configNodeId, "addr": JSON.stringify(ioPort)});
                }
                else {
                    pubSub.publish("show-status", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status." + element.error, "configNodeId": this.configNodeId});
                }
            }
            // check for portCommError if publishing for selected port (which is not available, for example if extension module is missing)
            if (element.error === "portCommError") {
                if (this.requestedIoPort !== "undefined" && this.requestedIoPort && (JSON.parse(this.requestedIoPort).addr === element.address)) {
                    RED.comms.publish("publish/ewio2/error/" + this.configNodeId, {code: ("status." + element.error)});
                }
            }
            // errors different to portCommError
            else {
                RED.comms.publish("publish/ewio2/error/" + this.configNodeId, {code: ("status." + element.error), message: element.errorMsg});
            }
        }
        else {
            // publish IO data
            RED.comms.publish("publish/ewio2/config/" + element.ioType + "/" + this.configNodeId + "/" + this.requestedIoPort + "/" + this.user, element);
            if (backendPublish) {
                // check and publish manual mode
                if (element.manualMode == "1") {
                    pubSub.publish("show-status-" + element.ioType, {"color": "yellow", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.manualModeActive", "configNodeId": this.configNodeId, "addr": JSON.stringify(ioPort)});
                }
                else {
                    pubSub.publish("show-status-" + element.ioType, {"color": "green", "shape": "dot", "message": "@metz-connect/node-red-ewio2/ewio2:status.connected", "configNodeId": this.configNodeId, "addr": JSON.stringify(ioPort)});
                }
                // flag to publish data to node output is set and not a websocket connection from config menu initiated
                if (sendInputPublish && !this.generalLivedataConfigMenu) {
                    if (element.ioType === "di" || element.ioType === "ai") {
                        pubSub.publish("send-value-" + element.ioType, {configNodeId: this.configNodeId, addr: JSON.stringify(ioPort), value: element.value, pulseCntrValue: element.pulseCntrValue, pulseCntrChecked: element.pulseCntrChecked, updated: element.updatedInput});
                    }
                    else if (element.ioType === "datapoints") {
                        // add configNodeId, which is needed by backend, to show values for selected EWIO2 connection
                        element["configNodeId"] = this.configNodeId;
                        pubSub.publish("send-value-" + element.ioType, element);
                    }
                }
            }
        }
    }

/**
 * Checks if values of ioType are already stored in connection object. This is an indication if values of ioType must be retrieved from EWIO2 or not.
 * @memberof Ewio2ConnObj
 * @param {string} ioType - Which type of IO should be checked for availability (e.g. "do", "ao").
 * @return {bool} Flag if ioType values already known.
 */
    isIoTypeValueKnown(ioType) {
        var ioTypeKnown = false;
        for (var ioKey in this.values) {
            if (this.values.hasOwnProperty(ioKey) && ioKey.toString().startsWith(ioType + "®")) {
               ioTypeKnown = true;
               break;
            }
        }
        return ioTypeKnown;
    }

/**
 * Deletes all values of given ioType or deletes all values of ioTypes "di", "ai", "do" and "ao".
 * @memberof Ewio2ConnObj
 * @param {string} ioType - Which type of IO should be deleted (e.g. "do", "ao"). If not present, all values of ioTypes "di", "ai", "do" and "ao" are deleted.
 */
    deleteAllStoredValues(ioType) {
        // check in descending order, to savely delete values
        for (var ioNumber = Object.keys(this.values).length - 1; ioNumber >= 0; ioNumber--) {
            let ioKey = Object.keys(this.values)[ioNumber];
            // delete values of given ioType
            if (ioType) {
                if (this.values.hasOwnProperty(ioKey) && ioKey.toString().startsWith(ioType + "®")) {
                    delete this.values[ioKey];
                }
            }
            // delete values of all ioTypes (digital IN, analog IN, digital OUT and analog OUT)
            else {
                if (this.values.hasOwnProperty(ioKey) && (ioKey.toString().startsWith("di®") || ioKey.toString().startsWith("ai®") || ioKey.toString().startsWith("do®") || ioKey.toString().startsWith("ao®"))) {
                    delete this.values[ioKey];
                }
            }
        }
    }

/**
 * Checks if one or more getPromises of ioType are pending. Needed to decide if data must be published (livedata received) or not (values requested).
 * @memberof Ewio2ConnObj
 * @param {string} ioType - Which type of IO should be checked for existance of getPromise (e.g. "do", "ao").
 * @return {bool} Flag if no getPromise is pending (true).
 */
    #noGetPromisePending(ioType) {
        let returnVal = false;
        if (!this.getPromises[ioType] || this.getPromises[ioType].length === 0) {
            returnVal = true;
        }
        return returnVal;
    }

/**
 * Closes websocket connection and deletes complete connection entry from ewio2Connections map.
 * @memberof Ewio2ConnObj
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 */
    closeAndDeleteWs(RED) {
        const node = RED.nodes.getNode(this.configNodeId);
        log(node, 'closeAndDeleteWs fct reached');
        if (this.ws) {
            this.ws.close();
        }
        this.ws = undefined;
        log(node, 'closeAndDeleteWs fct done');
    }

/**
 * Deletes the given node Id from registerd nodes (for connection to EWIO2).
 * If no other node is registerd to this EWIO2 websocket connection, the websocket is closed.
 * @memberof Ewio2ConnObj
 * @param {string} nodeId - Identification of the node, which should be de-registered.
 * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
 * @return {bool} Flag if websocket was closed and deleted.
 */
    deregisterNodeFromConnObj(nodeId, RED) {
        const node = RED.nodes.getNode(this.configNodeId);
        let wsClosedAndDeleted = false;
        log(node, 'deregisterNodeFromConnObj fct reached, deregister: ' + nodeId);
        if (this.registeredNodes.size) {
            log(node, 'registeredNodes: ' + new Array(...this.registeredNodes).join(' '));
            // deregister node
            const deletedNodeStatus = this.registeredNodes.delete(nodeId);
            log(node, 'deleted nodeID: ' + nodeId + ' from registerdNodes: ' + deletedNodeStatus);
            if (this.registeredNodes.size === 0) {
                wsClosedAndDeleted = true;
                this.closeAndDeleteWs(RED);
            }
        }
        else {
            log(node, 'NO registeredNodes (not connected to any EWIO2 via websocket?)');
        }
        log(node, 'deregisterNodeFromConnObj fct done');
        return wsClosedAndDeleted;
    }
}
module.exports = Ewio2Connection
