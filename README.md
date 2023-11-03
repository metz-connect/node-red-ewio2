@metz-connect/node-red-ewio2
============================

# Description
Nodes to integrate **[EWIO2 data logger](https://www.metz-connect.com/home/products/c-logline/energy-controlling/data-logger.6a.en.html)** and **[EWIO2 Ethernet I/Os](https://www.metz-connect.com/home/products/c-logline/i-o-components/ethernet-i-os.69.en.html)** of **[Metz Connect](https://www.metz-connect.com/home.1e.en.html)** into **Node-RED**.

The following nodes are included:
- **EWIO2** (configuration node): Establishes connection to EWIO2 data logger or Ethernet I/O of Metz Connect
- **EWIO2 - Digital OUT**: Set digital output of EWIO2
- **EWIO2 - Analog OUT**: Set analog output of EWIO2
- **EWIO2 - Digital IN**: Read digital input of EWIO2
- **EWIO2 - Analog IN**: Read analog input of EWIO2
- **EWIO2 - Metering**: Read metering value of EWIO2

# Installation
To be able to use EWIO2 Node-RED nodes, a EWIO2 device is required.
The latest firmware version of EWIO2 provides Node-RED functionality. Please update your EWIO2 to the newest version.

Nevertheless you can install EWIO2 Node-RED nodes with any Node-RED instance. Therefore you can install it via `Manage palette` and search for `@metz-connect/node-red-ewio2` in Install tab.

It is also possible to install EWIO2 Node-RED nodes manually with command line in your Node-RED user directory:
```
npm install @metz-connect/node-red-ewio2
```
After manually installation a restart of Node-RED is required.

# Usage
Help menu of Node-RED editor shows detailed documentation about every node.

## Nodes
This section shows the general usage of the EWIO2 Node-RED nodes and gives some hints about their usage.

### EWIO2
Configuration node to establish connection to EWIO2 and handle communication between Node-RED and EWIO2.

Host is required, this is the hostname or IP address of EWIO2. If no EWIO2 is available, no further configurations are possible.

Secure connections (SSL/TLS) are possible. Threrefore the `tls-config` node of Node-RED is included.

### EWIO2 - Digital OUT
Connection to EWIO2 via EWIO2 node is necessary, to load configuration of digital outputs and to set a value of a digital output.

### EWIO2 - Analog OUT
Connection to EWIO2 via EWIO2 node is necessary, to load configuration of analog outputs and to set a value of a analog output.

### EWIO2 - Digital IN
Connection to EWIO2 via EWIO2 node is necessary, to load configuration of digital inputs and to get a value of a digital input.

Port can be configured as signal input (boolean values) or as pulse counter (number values).

The `Node reactes to...` section handles when node should be active:
- `Input signal at node`: Node listens to input signals and handles them
- `Rising edge at EWIO2`, `Falling edge at EWIO2` or `Change in value at EWIO2`: Node listens to changes at digital input of EWIO2 and provides an output when value has changed

### EWIO2 - Analog IN
Connection to EWIO2 via EWIO2 node is necessary, to load configuration of analog inputs and to get a value of a analog input.

Configuration of analog input can be updated in nodes configuration menu.  Every change in configuration has immediately an effect at EWIO2!

The `Node reactes to...` section handles when node should be active:
- `Input signal at node`: Node listens to input signals and handles them
- `Change in value at EWIO2`: Node listens to changes at analog input of EWIO2 and provides an output when value has changed

### EWIO2 - Metering
Connection to EWIO2 via EWIO2 node is necessary to load configuration of meters and datapoints and to get measured values.

Configuration of meters and datapoints must be done previously at EWIO2 web-interface.

Default output of node is of datatype `number`, for example: `3.86` may be the output of a measurement. Output can be configured with `Additional node output values...`. If at least one flag is set, output datatype changes to `Object`. When for example both flags are set the output of the above mentioned node may be:
```
{
    "value":3.86,
    "timestamp":"2023-09-11 13:48:00",
    "flags":"S;A;P;G;N;I;T;D"
}
```

## EWIO2 Web interface
Node-RED is integrated into EWIO2 Web interface. The menu items `Node-RED -> Editor` and `Node-RED -> Dashboard` are available. Node-RED can be configured within menu `System -> Node-RED`. Dashboard is accessible without login to EWIO2 Web interface

# License
[BSD-3-Clause](LICENSE)