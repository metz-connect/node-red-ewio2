/**
 * @file Node to handle EWIO2 counters.
 * @author Metz Connect
 */

/**
 * ewio2 metering node namespace.
 * @namespace MeteringNode
 */

module.exports = function(RED) {
    /**
    * Stores settings from counter configuration menu.
    * Checks if all required settings are available, otherwise shows error status.
    * If the node is restarted, disable or deleted, this node is deregistered from registed nodes of ewio2Connections map.
    * @memberof MeteringNode
    * @param {Object} config - counter settings from counter menu (frontend).
    */
    function Ewio2MeteringNode(config) {
        const MD5 = require("crypto-js/md5");
        const {log, pubSub} = require("./backend/general");
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
                    }
                }
                log(node, 'subscribe "show-status": ' + node.id);
                pubSub.subscribe("show-status", showStatus);

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
                                        const msg = { payload: outMsgObj };
                                        node.send(msg);
                                    }
                                    // output only value
                                    else {
                                        let outValue = Number(valueStruct.value);
                                        const msg = { payload: outValue };
                                        node.send(msg);
                                    }
                                }
                            }
                        }
                    }
                }
                pubSub.subscribe("send-value-datapoints", sendValueDatapoints);

                (async function () {
                    const {getValue} = require("./backend/ewio2Connection");
                    // Eclipse shows 'await' warning due to jsdoc @return comment
                    await getValue(configData, "counter", node.counter, node.id, RED, configNodeTls);
                    if (node.counter) {
                        await getValue(configData, "datapoints", node.datapoint, node.id, RED, configNodeTls);
                    }
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
}
