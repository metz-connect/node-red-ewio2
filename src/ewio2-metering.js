/**
 * @file Node to handle EWIO2 counters.
 * @author Metz Connect
 */

/**
 * ewio2 metering node namespace.
 * @namespace MeteringNode
 */

module.exports = function(RED) {
    const {getValue, closeDeleteWebsocket} = require("./backend/ewio2Connection");
    const MD5 = require("crypto-js/md5");
    const {log, pubSub, sendStatusOutput} = require("./backend/general");
    /**
    * Stores settings from counter configuration menu.
    * Checks if all required settings are available, otherwise shows error status.
    * If the node is restarted, disable or deleted, this node is deregistered from registed nodes of ewio2Connections map.
    * @memberof MeteringNode
    * @param {Object} config - counter settings from counter menu (frontend).
    */
    function Ewio2MeteringNode(config) {
        RED.nodes.createNode(this,config);

        this.ewio2 = config.ewio2;
        this.name = config.name;
        this.counter = config.counter;
        this.datapoint = config.datapoint;
        this.range = config.range;
        this.value = config.value;
        this.timestamp = config.timestamp;
        this.flags = config.flags;
        this.outputTimestamp = config.outputTimestamp;
        this.outputFlags = config.outputFlags;
        this.outputTopic = config.outputTopic;
        this.quantity = config.quantity;

        let node = this;
        log(node, 'create node');
        log(node, 'ewio2 ID: ' + JSON.stringify(this.ewio2, null, 4));
        this.status({});
        if(this.ewio2 === "") {
            log(node, 'no EWIO2 selected');
            this.status({fill:"red",shape:"ring",text:"@metz-connect/node-red-ewio2/ewio2:status.missingEwio"});
        }
        else {
            const configNode = RED.nodes.getNode(this.ewio2);
            if(!configNode) {
                log(node, 'no EWIO2 (deactivated?)');
                this.status({fill:"red",shape:"ring",text:"@metz-connect/node-red-ewio2/ewio2:status.configNodeMissing"});
            }
            else if(configNode.host === "") {
                log(node, 'no host selected');
                this.status({fill:"red",shape:"ring",text:"@metz-connect/node-red-ewio2/ewio2:status.missingHost"});
            }
            else if(configNode.credentials.username === "") {
                log(node, 'no username selected');
                this.status({fill:"red",shape:"ring",text:"@metz-connect/node-red-ewio2/ewio2:status.missingUser"});
            }
            else if(configNode.credentials.password === "") {
                log(node, 'no password selected');
                this.status({fill:"red",shape:"ring",text:"@metz-connect/node-red-ewio2/ewio2:status.missingPw"});
            }
            else if(configNode.encryption === "") {
                log(node, 'no encryption selected');
                this.status({fill:"red",shape:"ring",text:"@metz-connect/node-red-ewio2/ewio2:status.missingEnc"});
            }
            else {
                const configNodeTls = RED.nodes.getNode(configNode.tlsConfig);
                log(node, 'host: ' + JSON.stringify(configNode.host, null, 4));
                log(node, 'user: ' + JSON.stringify(configNode.credentials.username, null, 4));
                log(node, 'pw: ' + JSON.stringify(configNode.credentials.password, null, 4));
                log(node, 'enc: ' + JSON.stringify(configNode.encryption, null, 4));

                const configData = {configNodeId: this.ewio2, host: configNode.host, user: configNode.credentials.username, pw: MD5(configNode.credentials.password), enc: configNode.encryption};

                // same function name as in other nodes (pubSub in ewio2Connection.js publishes general errors to all nodes)
                function showStatus(status) {
                    log(node, 'counter recv ioport: ' + status.addr + '; ioport: ' + this.counter + '; node.id: ' + node.id + '; this.ewio2: ' + this.ewio2 + '; status.configNodeId: ' + status.configNodeId + "; msg: " + status.message);
                    // selected EWIO2 configuration node ID is equal to received (from EWIO2 livechannel or from ewio2Connections map) EWIO2 configuration node ID (for this node)
                    if (config.ewio2 == status.configNodeId) {
                        log(node, 'updated nodeID: ' + node.id);
                        node.status({fill: status.color, shape: status.shape, text: status.message});
                        sendStatusOutput(status, node, RED);
                    }
                }
                log(node, 'subscribe "show-status": ' + node.id);
                pubSub.subscribe("show-status", showStatus);

                // handles counter errors received from pubSub in ewio2Connection.js and shows status by calling showStatus fct above (in ewio2-counters.js)
               function showStatusCounter(status) {
                    // received IO port (from EWIO2 livechannel or from ewio2Connections map) is equal to selected IO port (for this node)
                    // received IO port may be empty for errors not related to an IO (e.g. "wrong credentials")
                    if (status.addr === config.counter) {
                        showStatus(status);
                    }
                }
                pubSub.subscribe("show-status-counter", showStatusCounter);

                // handles counter errors received from pubSub in ewio2Connection.js and shows status by calling showStatus fct above (in ewio2-counters.js)
                function showStatusDatapoints(status) {
                    // received IO port (from EWIO2 livechannel or from ewio2Connections map) is equal to selected IO port (for this node)
                    // received IO port may be empty for errors not related to an IO (e.g. "wrong credentials")
                    if (status.addr === config.datapoint) {
                        showStatus(status);
                    }
                }
                pubSub.subscribe("show-status-datapoints", showStatusDatapoints);

                function sendValueDatapoints(valueStruct) {
                    if (node.datapoint) {
                        const dpObject =JSON.parse(node.datapoint);
                        // configuration node ID fits
                        if (valueStruct.configNodeId === config.ewio2) {
                            // counter ID fits
                            if (dpObject.cntr === valueStruct.counterId) {
                                // datapoint ID fits
                                if (dpObject.dp === valueStruct.id) {
                                    // output more than just value (for example additionally timestamp and/or flags)
                                    if (node.outputTimestamp || node.outputFlags) {
                                        let outMsgObj = {};
                                        // valid value received
                                        if (valueStruct.value != "") {
                                            outMsgObj["value"] = Number(valueStruct.value);
                                        }
                                        // valid timestamp received
                                        if (node.outputTimestamp && valueStruct.timestamp != "") {
                                            outMsgObj["timestamp"] = valueStruct.timestamp;
                                        }
                                        // valid flags received
                                        if (node.outputFlags && valueStruct.flags != "") {
                                            outMsgObj["flags"] = valueStruct.flags;
                                        }
                                        let msg = { payload: outMsgObj };
                                        if (node.outputTopic) {
                                            msg = { payload: outMsgObj, topic: node.outputTopic };
                                        }
                                        node.send(msg);
                                    }
                                    // output only value
                                    else {
                                        let outValue = Number(valueStruct.value);
                                        let msg = { payload: outValue };
                                        if (node.outputTopic) {
                                            msg = { payload: outValue, topic: node.outputTopic };
                                        }
                                        node.send(msg);
                                    }
                                }
                            }
                        }
                    }
                }
                pubSub.subscribe("send-value-datapoints", sendValueDatapoints);

                node.on('input', async function(msg, send, done) {
                    // check for correct timestamps (timestamps(topic): {from: timestamp1, to: timestamp2})
                    if (msg.topic && typeof msg.topic === "string") {
                        if (msg.topic === "timestamps") {
                            if (typeof msg.payload === "object") {
                                const inputObj = msg.payload;
                                if (inputObj.from && typeof inputObj.from === "number" && inputObj.to && typeof inputObj.to === "number") {
                                    await prepareGetHistoricData(node, configNode, RED, configNodeTls, msg.payload, msg.topic, configData);
                                }
                                else {
                                    log(node, 'from and/or to as input element missing');
                                    pubSub.publish("show-status-datapoints", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.noFromTo", "configNodeId": this.ewio2, "addr": this.datapoint});
                                }
                            }
                            else {
                                log(node, 'not an object as input');
                                pubSub.publish("show-status-datapoints", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.noObject", "configNodeId": this.ewio2, "addr": this.datapoint});
                            }
                        }
                        else if (msg.topic === "from") {
                            if (typeof msg.payload === "number") {
                                await prepareGetHistoricData(node, configNode, RED, configNodeTls, msg.payload, msg.topic, configData);
                            }
                            else {
                                log(node, 'not a number as input');
                                pubSub.publish("show-status-datapoints", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.noNumber", "configNodeId": this.ewio2, "addr": this.datapoint});
                            }
                        }
                        else if (msg.topic === "livedata") {
                            // check if valid quantity is available (from node input)
                            var measurementQuantity = 0;
                            if (msg.payload && typeof msg.payload === "number" && msg.payload > 0) {
                                measurementQuantity = msg.payload;
                            }
                            await establishLivedataConnection(configData, node, RED, configNodeTls, configNode, measurementQuantity);
                        }
                        else {
                            log(node, 'wrong topic');
                            pubSub.publish("show-status-datapoints", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.wrongMsgTopic", "configNodeId": this.ewio2, "addr": this.datapoint});
                        }
                    }
                    else {
                        log(node, 'wrong topic type (not string)');
                        pubSub.publish("show-status-datapoints", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.wrongMsgTopicType", "configNodeId": this.ewio2, "addr": this.datapoint});
                    }
                    if (done) {
                        done();
                    }
                });

                (async function () {
                    await establishLivedataConnection(configData, node, RED, configNodeTls, configNode, node.quantity);
                })();

                node.on("close", function(done) {
                    const {deregisterNode} = require("./backend/ewio2Connection");
                    log(node, 'node disabled / deleted / restarted -> unsubscribe "show-status": ' + node.id);
                    pubSub.unsubscribe("show-status");
                    pubSub.unsubscribe("show-status-datapoints");
                    pubSub.unsubscribe("send-value-datapoints");
                    log(node, 'node disabled / deleted -> deregister from websocket connection": ' + node.id);
                    const userData = {configNodeId: configNode.id, host: configNode.host, user: configNode.credentials.username, pw: MD5(configNode.credentials.password), enc: configNode.encryption};
                    deregisterNode( function () {
                        log(node, 'callback deregisterNode fct DONE');
                        done();
                    }, userData, node.id, RED);
                });
            }
        }
    }
    RED.nodes.registerType("EWIO2 - Metering",Ewio2MeteringNode);

    /**
     * Establishes connection to EWIO2, to request counter data and datapoints.
     * Additional historic measurement data are requested from data base, if quantity is set and valid.
     * @memberof MeteringNode
     * @param {Object} configData - Object with configuration node ID,  host, user, pw and encryption flag, used as key for ewio2Connections object.
     * @param {Object} node - The current metering node itself.
     * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
     * @param {Object} configNodeTls - TLS config data object, to establish a encrypted connection.
     * @param {Object} configNode - The current EWIO2 configuration node.
     * @param {number} quantity - Quantity of requested measurement data from data base.
     */
    async function establishLivedataConnection(configData, node, RED, configNodeTls, configNode, quantity) {
        // clear previous content of diagramm
        node.send({ payload: []});

        // Eclipse shows 'await' warning due to jsdoc @return comment
        await getValue(configData, "counter", node.counter, node.id, RED, configNodeTls);
        if (node.counter) {
            await getValue(configData, "datapoints", node.datapoint, node.id, RED, configNodeTls);
            // if valid quantity is available, request latest measurement data from data base
            if (quantity && quantity > 0) {
                log(node, 'positive quantity of ' + quantity + ' available -> request historic measurement data');
                var configDataHistory = {configNodeId: node.ewio2, host: configNode.host, user: configNode.credentials.username, pw: MD5(configNode.credentials.password), enc: configNode.encryption, type: "measurements"};
                let conn = await getValue(configDataHistory, "measurements", node.datapoint, node.id, RED, configNodeTls);
                await getHistoricData(conn, node, MD5(configNode.credentials.password + conn.tan), "-1", quantity);
                closeDeleteWebsocket(undefined, configDataHistory, RED);
            }
        }
    }

    /**
     * Prepares request historic measurement data from data base.
     * The request contains "from" and "to" timestamps or just the "from" timestamp with optional quantity of measurement values (otherwise default is 24).
     * After the historic data are received, the existing livedata connection and the currently request historic data connection is closed.
     * @memberof MeteringNode
     * @param {Object} node - The current metering node itself.
     * @param {Object} configNode - The current EWIO2 configuration node.
     * @param {Object} RED - Node-RED "infrastructure", used to publish events to frontend.
     * @param {Object} configNodeTls - TLS config data object, to establish a encrypted connection.
     * @param {Object | string} payload - either object with "from" and "to" timestamp or string with "from" timestamp.
     * @param {string} topic - topic of the input message, either "timestamps" or "from"
     * @param {Object} configData - Object with configuration node ID,  host, user, pw and encryption flag, used as key for ewio2Connections object.
     */
    async function prepareGetHistoricData(node, configNode, RED, configNodeTls, payload, topic, configData) {
        // clear previous content of diagramm
        node.send({ payload: []});

        // request measurement data from ... to via REST API and close EWIO2 connection with active livedata
        var configDataMeasurements = {configNodeId: node.ewio2, host: configNode.host, user: configNode.credentials.username, pw: MD5(configNode.credentials.password), enc: configNode.encryption, type: "measurements"};
        configDataMeasurements.type = "measurements";
        // request measurement data via REST API and close EWIO2 connection with active livedata (see below --> close...)
        let conn = await getValue(configDataMeasurements, "measurements", node.datapoint, node.id, RED, configNodeTls);
        var start;
        var end;
        // request meaurement data "from" -> "to"
        if (topic === "timestamps") {
            start = new Date(payload.from).toISOString();
            end = new Date(payload.to).toISOString();
            // remove milliseconds from timestamp (ISO) and use " " (space) instead of "T" (required by EWIO2 REST API)
            start = start.slice(0, start.length - 5).replace("T", " ");
            end = end.slice(0, end.length - 5).replace("T", " ");
            log(node, 'get historic measurement data from ' + start + ' to ' + end + '(quantity 0)');
            await getHistoricData(conn, node, MD5(configNode.credentials.password + conn.tan), "1|" + start + "|" + end, 0);
        }
        // request measurement data "from" with optional quantity
        else if (topic === "from") {
            start = new Date(payload).toISOString();
            // remove milliseconds from timestamp (ISO) and use " " (space) instead of "T" (required by EWIO2 REST API)
            start = start.slice(0, start.length - 5).replace("T", " ");
            var quantity = node.quantity;
            // no quantity defined -> use 24
            if (!quantity || quantity === 0) {
                quantity = 24;
            }
            log(node, 'get historic measurement data from ' + start + ' (quantity ' + quantity + ')');
            await getHistoricData(conn, node, MD5(configNode.credentials.password + conn.tan), "1|" + start, quantity);
        }
        // close previously opened connection to EWIO2, because livedata are not needed anymore
        closeDeleteWebsocket(undefined, configData, RED);
        closeDeleteWebsocket(undefined, configDataMeasurements, RED);
    }

    /**
     * Request historic measurement data from data base.
     * Format node output that it fits to chart node input of Node-RED dashboard.
     * @memberof MeteringNode
     * @param {Object} conn - Connection object with details to connect to EWIO2.
     * @param {Object} node - The current metering node itself.
     * @param {string} pwHash - Hashed password which is used by EWIO2 REST API.
     * @param {Object} valueRange - Time range of requested data (last dates or dates begining at ... and ending at ....
     * @param {number} quantity - Quantity of requested measurement data from data base.
     */
    async function getHistoricData(conn, node, pwHash, valueRange, quantity) {
        node.send({ "enabled": false });
        try {
            const currentDp = JSON.parse(node.datapoint).dp;
            const measurementSettings = {pw: pwHash, dp: currentDp, range: encodeURI(valueRange), quantity: quantity};
            // retrieve measurement data from data base
            var values = await conn.connectRestApi(RED, measurementSettings);
            if (values && values !== "LOGIN ERROR") {
                values = JSON.parse(values);
                let channelData = values.data.channel_data;
                if (channelData && channelData.length > 0) {
                    channelData.forEach(function(value) {
                        delete value.Kanal_ID;
                        delete value.Grund;
                        // rename "Zeit" to "x"
                        Object.defineProperty(value, "x", Object.getOwnPropertyDescriptor(value, "Zeit"));
                        // append "Z" to datetime-string, in cases where measurement data are stored in UTC (to show show in local time)
                        if (value.Flags.slice(0, 1) === "T") {
                            value.x = value.x + "Z";
                        }
                        delete value.Zeit;
                        delete value.Flags;
                        value.x = Date.parse(value.x);
                        // rename "Werte" to "y"
                        Object.defineProperty(value, "y", Object.getOwnPropertyDescriptor(value, "Werte"));
                        delete value.Werte;
                    });
                    // sort data according time (x)
                    const sortedData = Object.keys(channelData).map(key => channelData[key]).sort((a, b) => a.x > b.x ? 1 : -1);
                    // Formatting of output data, that it fits to chart node input.
                    var jsonData = [];
                    jsonData.push(sortedData);
                    const label = node.outputTopic;
                    const measurements = [{ "series": [label], "data": jsonData, "labels": [""] }];
                    const msg = { payload: measurements, topic: node.outputTopic };
                    log(node, 'send data base data to node output, lenght: ' + channelData.length);
                    // show connected status when retrieving database data
                    pubSub.publish("show-status-datapoints", {"color": "green", "shape": "dot", "message": "@metz-connect/node-red-ewio2/ewio2:status.connected", "configNodeId": node.ewio2, "addr": node.datapoint});
                    node.send(msg);
                }
                else {
                    log(node, 'no historic data available');
                    pubSub.publish("show-status-datapoints", {"color": "yellow", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.noData", "configNodeId": node.ewio2, "addr": node.datapoint});
                }
            }
            else {
                log(node, 'login failed');
                pubSub.publish("show-status-datapoints", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.loginFailed", "configNodeId": node.ewio2, "addr": node.datapoint});
            }
        }
        catch (error) {
            log(node, 'getting measurement values failed: ' + error);
            pubSub.publish("show-status-datapoints", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.getMeasurementsFailed", "configNodeId": node.ewio2, "addr": node.datapoint});
        }
        finally {
            node.send({ "enabled": true });
        }
    }
}
