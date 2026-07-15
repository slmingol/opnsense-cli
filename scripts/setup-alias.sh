#!/bin/bash
#
# OPNsense CLI - Shell Alias Setup
#
# This script adds a convenient shell alias for the OPNsense CLI tool.
#
# INSTALLATION:
# Add this line to your ~/.bashrc or ~/.zshrc:
#
#   source /path/to/opnsense-cli/scripts/setup-alias.sh
#
# Or run it once to test:
#
#   source /path/to/opnsense-cli/scripts/setup-alias.sh
#
# USAGE EXAMPLES:
#
# Get help (list all available commands):
#   opnsense help                                                      # Show all make targets
#   opnsense cli-help                                                  # Show CLI --help output
#
# Complete Service Deployment (DNS + HAProxy):
#   opnsense add-service ALIAS=myapp PORT=3000 DESC="My Application"
#   opnsense add-service ALIAS=grafana PORT=3000 DESC="Grafana - https://grafana.com"
#
# DNS Management:
#   opnsense dns-list                                                  # List all DNS entries
#   opnsense dns-add HOST=server DOMAIN=bub.lan IP=192.168.7.50 DESC="My server"
#   opnsense dns-update HOST=server DOMAIN=bub.lan IP=192.168.7.51
#   opnsense dns-delete HOST=server DOMAIN=bub.lan
#
# DNS Aliases:
#   opnsense dns-alias-add HOST=server DOMAIN=bub.lan ALIAS=web ALIAS_DOMAIN=bub.lan DESC="Web alias"
#   opnsense dns-alias-delete HOST=server DOMAIN=bub.lan ALIAS=web ALIAS_DOMAIN=bub.lan
#   opnsense add-dual-alias ALIAS=myservice DESC="My Service"         # Add to both .bub.lan and .lamolabs.org
#
# HAProxy Management:
#   opnsense haproxy-list                                              # List all HAProxy backends
#   opnsense haproxy-add NAME=myapp SERVER=myapp.bub.lan PORT=8080
#   opnsense haproxy-delete NAME=myapp
#
# DHCP Management:
#   opnsense dhcp-list                                                 # List DHCP static mappings
#   opnsense dhcp-add IFACE=lan MAC=aa:bb:cc:dd:ee:ff IP=192.168.7.50 HOSTNAME_VAL=mydevice
#
# Other Commands:
#   opnsense build                                                     # Rebuild Docker image
#   opnsense test-api                                                  # Test API connectivity
#   opnsense clean                                                     # Clean up Docker resources
#
# For a full list of available commands with descriptions, run:
#   opnsense help
#

# Create the alias (update path to match your installation)
alias opnsense='make -C /path/to/opnsense-cli'

# Confirm alias is set
if [ -n "$BASH_VERSION" ] || [ -n "$ZSH_VERSION" ]; then
    echo "✓ OPNsense CLI alias configured. Type 'opnsense' to use it."
    echo "  Run 'opnsense help' to see all available commands"
fi
