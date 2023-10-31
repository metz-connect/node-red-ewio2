/**
 * @file Node to handle EWIO2 digital inputs.
 * @author Metz Connect
 */

/**
 * ewio2 digital input node namespace.
 * @namespace DigitalInNode
 */

module.exports = function(RED) {
    /**
    * Stores settings from digital IN configuration menu.
    * Checks if all required settings are available, otherwise shows error status.
    * 
    * If the node is restarted, disable or deleted, this node is deregistered from registed nodes of ewio2Connections map.
    * @memberof DigitalInNode
    * @param {Object} config - digital IN settings from digital IN menu (frontend).
    */
    function EwioDigitalInputsNode(config) {
        const MD5 = require("crypto-js/md5");
        const {log, pubSub} = require("./backend/general");
        RED.nodes.createNode(this,config);

        this.ewio2 = config.ewio2;
        this.name = config.name;
        this.ioportDi = config.ioportDi;
        this.value = config.value;
        this.valueText = config.valueText;
        this.pulseCntr = config.pulseCntr;
        this.inputSignal = config.inputSignal;
        this.risingEdge = config.risingEdge;
        this.fallingEdge = config.fallingEdge;

        let node = this;
        log(node, "create node");
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
                log(node, 'user: ' + JSON.stringify(configNode.credentials.username, null, 4));
                log(node, 'user: ' + JSON.stringify(configNode.credentials.username, null, 4));
                log(node, 'pw: ' + JSON.stringify(configNode.credentials.password, null, 4));
                log(node, 'enc: ' + JSON.stringify(configNode.encryption, null, 4));

                var configData = {configNodeId: this.ewio2, host: configNode.host, user: configNode.credentials.username, pw: MD5(configNode.credentials.password), enc: configNode.encryption};

                // same function name as in other nodes (pubSub in ewio2Connection.js publishes general errors to all nodes)
                function showStatus(status) {
                    log(node, 'DI recv ioport: ' + status.addr + '; ioport: ' + this.ioportDi + '; node.id: ' + node.id + '; this.ewio2: ' + this.ewio2 + '; status.configNodeId: ' + status.configNodeId + "; msg: " + status.message);
                    // selected EWIO2 configuration node ID is equal to received (from EWIO2 livechannel or from ewio2Connections map) EWIO2 configuration node ID (for this node)
                    if (config.ewio2 == status.configNodeId) {
                        log(node, 'updated nodeID: ' + node.id);
                        node.status({fill: status.color, shape: status.shape, text: status.message});
                    }
                }
                log(node, 'subscribe "show-status": ' + node.id);
                pubSub.subscribe("show-status", showStatus);

                // handles digital IN errors received from pubSub in ewio2Connection.js and shows status by calling showStatus fct above (in digital-inputs.js)
                function showStatusDi(status) {
                    // received IO port (from EWIO2 livechannel or from ewio2Connections map) is equal to selected IO port (for this node)
                    // received IO port may be empty for errors not related to an IO (e.g. "wrong credentials")
                    if (status.addr && config.ioportDi) {
                        if (status.addr === config.ioportDi) {
                            showStatus(status);
                        }
                    }
                }
                pubSub.subscribe("show-status-di", showStatusDi);

                function sendValueDi(valueStruct) {
                    // configuration node ID fits
                    if (valueStruct.configNodeId === config.ewio2) {
                        // port address (e.g. 00_0) fits (IO type already known by publish/subscribe topic ("send-value-di)
                        if (valueStruct.addr === config.ioportDi) {
                            let value;
                            // invalid values are 'undefined'
                            if (!valueStruct.value || valueStruct.value === "ERROR") {
                                value = undefined;
                            }
                            else {
                                // pulse counter checked (activated) flag changed
                                if (valueStruct.updated & 0x04) {
                                    // convert pulseCntrChecked ("1" --> "true"; "0" --> "false"), due to different formats of Node-RED and EWIO2
                                    node.pulseCntr = (valueStruct.pulseCntrChecked === "1") ? "true" : "false";
                                }
                                // rising edge flag set and HIGH received            or pulse cntr value updated     or falling edge flag set and LOW received            or requested value (getValue)
                                if ((config.risingEdge && (valueStruct.value === "1" || valueStruct.updated & 0x02)) || (config.fallingEdge && valueStruct.value === "0") || (valueStruct.updated & 0x08)) {
                                    // pulse counter value --> convert to Number
                                    if (node.pulseCntr === "true") {
                                        if (valueStruct.updated & 0x02 || valueStruct.updated & 0x08) {
                                            value = Number(valueStruct.pulseCntrValue);
                                        }
                                        // pulse counter activated
                                        else {
                                            if (valueStruct.updated & 0x04) {
                                                node.send({payload: Number(valueStruct.pulseCntrValue)});
                                            }
                                            return;
                                        }
                                    }
                                    // signal counter
                                    else {
                                        if (valueStruct.updated & 0x01 || valueStruct.updated & 0x08) {
                                            // convert to boolean
                                            value = (valueStruct.value === "1");
                                        }
                                        // pulse counter deactivated
                                        else {
                                            if (valueStruct.updated & 0x04) {
                                                node.send({payload: (valueStruct.value === "1")});
                                            }
                                            return;
                                        }
                                    }
                                }
                                else {
                                    return;
                                }
                            }
                            log(node, 'onConnect getValue DONE ' + node.id + '; value: ' + JSON.stringify(valueStruct, null, 4) + "; typeof: " + typeof value);
                            var msg = { payload: value };
                            node.send(msg);
                        }
                    }
                }
                pubSub.subscribe("send-value-di", sendValueDi);

                // establish automatically connection to EWIO2 and retrieve value once, to also be able to listen to further msgs on livedata channel
                if (this.risingEdge || this.fallingEdge) {
                    (async function () {
                        const {getValue} = require("./backend/ewio2Connection");
                        // Eclipse shows 'await' warning due to jsdoc @return comment
                        await getValue(configData, "di", node.ioportDi, node.id, RED, configNodeTls);
                    })();
                }

                node.on('input', async function(msg, send, done) {
                    const {getValue, setValue} = require("./backend/ewio2Connection");
                    // only get value when 'trigger on input signal' checkbox is checked
                    if (this.inputSignal) {
                        log(node, 'msg.topic: ' + msg.topic);
                        if (typeof msg.topic === "string") {
                            // read value from EWIO2
                            if (msg.topic === "trigger") {
                                // Eclipse shows 'await' warning due to jsdoc @return comment
                                const values = await getValue(configData, "di", this.ioportDi, node.id, RED, configNodeTls);
                            }
                            // set pulse counter / signal input for port
                            else if (msg.topic === "pulse") {
                                if (typeof msg.payload === "number" || typeof msg.payload === "boolean") {
                                    // keep boolean true / false and convert number equal 0 -> false / number > 0 or < 0 -> true
                                    msg.payload = (msg.payload) ? 1 : 0;
                                    log(node, 'msg.payload: ' + msg.payload);
                                    await setValue(configData, msg.payload, "di", this.ioportDi, node.id, RED, "setS0", configNodeTls);
                                    log(node, 'di setS0 DONE ' + node.id);
                                }
                                else {
                                    log(node, 'msg.payload WRONG TYPE');
                                    pubSub.publish("show-status-di", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.noBoolOrNumber", "configNodeId": this.ewio2, "addr": this.ioportDi});
                                }
                            }
                            // set pulse counter value
                            else if (msg.topic === "counter") {
                                if (typeof msg.payload === "number") {
                                    if (this.pulseCntr === "true") {
                                        log(node, 'msg.payload: ' + msg.payload);
                                        await setValue(configData, msg.payload, "di", this.ioportDi, node.id, RED, "setPC", configNodeTls);
                                        log(node, 'di setPC DONE ' + node.id);
                                    }
                                    // not a pulse counter
                                    else {
                                        log(node, 'not a pulse counter');
                                        pubSub.publish("show-status-di", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.notPulseCntr", "configNodeId": this.ewio2, "addr": this.ioportDi});
                                    }
                                }
                                // payload is not a 'number'
                                else {
                                    log(node, 'msg.payload WRONG TYPE');
                                    pubSub.publish("show-status-di", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.noNumber", "configNodeId": this.ewio2, "addr": this.ioportDi});
                                }
                            }
                            // unknown topic
                            else {
                                log(node, 'wrong topic');
                                pubSub.publish("show-status-di", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.wrongMsgTopic", "configNodeId": this.ewio2, "addr": this.ioportDi});
                            }
                        }
                        else {
                            log(node, 'wrong topic type (not string)');
                            pubSub.publish("show-status-di", {"color": "red", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.wrongMsgTopicType", "configNodeId": this.ewio2, "addr": this.ioportDi});
                        }
                    }
                    else {
                        log(node, 'trigger on input signal not active');
                        pubSub.publish("show-status-di", {"color": "yellow", "shape": "ring", "message": "@metz-connect/node-red-ewio2/ewio2:status.triggerInputInactive", "configNodeId": this.ewio2, "addr": this.ioportDi});
                    }
                    if (done) {
                        done();
                    }
                });
                node.on("close", function(done) {
                    const {deregisterNode} = require("./backend/ewio2Connection");
                    log(node, 'node disabled / deleted / restarted -> unsubscribe "show-status": ' + node.id);
                    pubSub.unsubscribe("show-status");
                    pubSub.unsubscribe("show-status-di");
                    pubSub.unsubscribe("send-value-di");
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
    RED.nodes.registerType("EWIO2 - Digital IN",EwioDigitalInputsNode);
}
 
 
