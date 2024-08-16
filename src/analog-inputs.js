/**
 * @file Node to handle EWIO2 analog inputs.
 * @author Metz Connect
 */

/**
 * ewio2 analog input node namespace.
 * @namespace AnalogInNode
 */

module.exports = function(RED) {
    /**
    * Stores settings from analog IN configuration menu.
    * Checks if all required settings are available, otherwise shows error status.
    * If the node is restarted, disable or deleted, this node is deregistered from registed nodes of ewio2Connections map.
    * @memberof AnalogInNode
    * @param {Object} config - analog IN settings from analog IN menu (frontend).
    */
    function EwioAnalogInputsNode(config) {
        const MD5 = require("crypto-js/md5");
        const {log, pubSub, sendStatusOutput} = require("./backend/general");
        RED.nodes.createNode(this,config);

        this.ewio2 = config.ewio2;
        this.name = config.name;
        this.ioportAi = config.ioportAi;
        this.value = config.value;
        this.valueConfig = config.valueConfig;
        this.inputSignal = config.inputSignal;
        this.valueUpdate = config.valueUpdate;
        this.outputTopic = config.outputTopic;

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
                    log(node, 'AI recv ioport: ' + status.addr + '; ioport: ' + this.ioportAi + '; node.id: ' + node.id + '; this.ewio2: ' + this.ewio2 + '; status.configNodeId: ' + status.configNodeId + "; msg: " + status.message);
                    // selected EWIO2 configuration node ID is equal to received (from EWIO2 livechannel or from ewio2Connections map) EWIO2 configuration node ID (for this node)
                    if (config.ewio2 == status.configNodeId) {
                        log(node, 'updated nodeID: ' + node.id);
                        node.status({fill: status.color, shape: status.shape, text: status.message});
                        sendStatusOutput(status, node, RED);
                    }
                }
                log(node, 'subscribe "show-status": ' + node.id);
                pubSub.subscribe("show-status", showStatus);

                // handles analog IN errors received from pubSub in ewio2Connection.js and shows status by calling showStatus fct above (in analog-inputs.js)
                function showStatusAi(status) {
                    // received IO port (from EWIO2 livechannel or from ewio2Connections map) is equal to selected IO port (for this node)
                    // received IO port may be empty for errors not related to an IO (e.g. "wrong credentials")
                    if (status.addr && config.ioportAi) {
                        if (status.addr === config.ioportAi) {
                            showStatus(status);
                        }
                    }
                }
                pubSub.subscribe("show-status-ai", showStatusAi);

                function sendValueAi(valueStruct) {
                    // configuration node ID fits
                    if (valueStruct.configNodeId === config.ewio2) {
                        // port address (e.g. 00_0) fits (IO type already known by publish/subscribe topic ("send-value-ai)
                        if (valueStruct.addr === config.ioportAi) {
                            let value;
                            // errors are 'undefined'
                            if (valueStruct.value === "ERROR") {
                                value = undefined;
                            }
                            else {
                                // value update flag set, updated value received and updated value is valid       or requested value (getValue)
                                if ((config.valueUpdate && valueStruct.updated & 0x01 && valueStruct.value != "") || (valueStruct.updated & 0x08)) {
                                    // convert to number
                                    value = Number(valueStruct.value);
                                }
                                // not relevant values are ignored
                                else {
                                    return;
                                }
                            }
                            log(node, 'onConnect ai getValue DONE ' + node.id + '; value: ' + JSON.stringify(valueStruct, null, 4) + "; typeof: " + typeof value);
                            var msg = { payload: value };
                            if (node.outputTopic) {
                                msg = { payload: value, topic: node.outputTopic };
                            }
                            node.send(msg);
                        }
                    }
                }
                pubSub.subscribe("send-value-ai", sendValueAi);

                // establish automatically connection to EWIO2 and retrieve value once, to also be able to listen to further msgs on livedata channel
                if (this.valueUpdate) {
                    (async function () {
                        const {getValue} = require("./backend/ewio2Connection");
                        // Eclipse shows 'await' warning due to jsdoc @return comment
                        await getValue(configData, "ai", node.ioportAi, node.id, RED, configNodeTls);
                    })();
                }

                node.on('input', async function(msg, send, done) {
                    const {getValue} = require("./backend/ewio2Connection");
                    // only get value when 'trigger on input signal' checkbox is checked
                    if (this.inputSignal) {
                        log(node, 'msg.topic: ' + msg.topic);
                        if (typeof msg.topic === "string") {
                            // read value from EWIO2
                            if (msg.topic === "trigger") {
                                // Eclipse shows 'await' warning due to jsdoc @return comment
                                const values = await getValue(configData, "ai", this.ioportAi, node.id, RED, configNodeTls);
                            }
                            // unknown topic
                            else {
                                log(node, 'wrong topic');
                                pubSub.publish("show-status-ai", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.wrongMsgTopic", "configNodeId": this.ewio2, "addr": this.ioportAi});
                            }
                        }
                        else {
                            log(node, 'wrong topic type (not string)');
                            pubSub.publish("show-status-ai", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.wrongMsgTopicType", "configNodeId": this.ewio2, "addr": this.ioportAi});
                        }
                    }
                    else {
                        log(node, 'trigger on input signal not active');
                        pubSub.publish("show-status-ai", {"color": "yellow", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.triggerInputInactive", "configNodeId": this.ewio2, "addr": this.ioportAi});
                    }
                    if (done) {
                        done();
                    }
                });
                node.on("close", function(done) {
                    const {deregisterNode} = require("./backend/ewio2Connection");
                    log(node, 'node disabled / deleted / restarted -> unsubscribe "show-status": ' + node.id);
                    pubSub.unsubscribe("show-status");
                    pubSub.unsubscribe("show-status-ai");
                    pubSub.unsubscribe("send-value-ai");
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
    RED.nodes.registerType("EWIO2 - Analog IN",EwioAnalogInputsNode);
}
 
 
