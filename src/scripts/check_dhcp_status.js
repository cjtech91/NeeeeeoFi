const networkConfigService = require('../services/networkConfigService');

// Initialize to load config from DB/File
try {
    networkConfigService.init();
    
    const dhcp = networkConfigService.getDhcpConfig();
    
    console.log('\n=== DHCP Configuration ===');
    console.log(`Bitmask: /${dhcp.bitmask}`);
    console.log(`DNS: ${dhcp.dns1}, ${dhcp.dns2}`);
    
    console.log('\n=== Active DHCP Servers ===');
    if (dhcp.servers && dhcp.servers.length > 0) {
        console.table(dhcp.servers);
    } else {
        console.log('No additional DHCP servers configured (Standard LAN only).');
    }

    const bridges = networkConfigService.getBridges();
    console.log('\n=== Bridge Interfaces ===');
    console.table(bridges);

} catch (error) {
    console.error('Failed to load configuration:', error.message);
}
