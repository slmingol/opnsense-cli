export NODE_NO_WARNINGS = 1
export BUILDKIT_PROGRESS = quiet

.PHONY: build run dns-list dns-add dns-update dns-delete dns-alias-add dns-alias-delete add-dual-alias haproxy-list haproxy-add haproxy-delete add-service delete-service list-hosts help cli-help test-api check-version wg-status wg-provision wg-apply wg-dry-run wg-teardown fw-rule-list fw-rule-add fw-rule-delete fw-rule-update fw-alias-list fw-alias-create fw-alias-add-host fw-alias-remove-host fw-alias-delete bulk-import bulk-export cert-list cert-import cert-delete cert-check config-history config-history-prune config-history-schedule config-history-unschedule config-history-cron-status dhcp-list dhcp-add dhcp-update dhcp-delete
.DEFAULT_GOAL := help

HOST_BUB      ?= docker-host-01-svcs
HOST_LAMOLABS ?= lamolabs-svcs
SSL           ?= false

# WireGuard / ProtonVPN defaults (override on command line)
TUNNEL      ?= ProtonVPN01
IFACE       ?= PROTONVPN
GW          ?=
GW_GROUP    ?= ProtonVPN_GWGrp
LISTEN_PORT ?= 51821
MTU         ?= 1420
MONITOR_IP  ?= 1.1.1.1
LAN_SUBNET  ?= 192.168.7.0/24
LAN         ?= lan
KS_ALIAS    ?=

help: ## Show this help message
	@printf "\n\033[1;37mOPNsense CLI\033[0m — DNS, DHCP & HAProxy management\n\n"
	@awk 'BEGIN {FS = ":.*?## "} \
	  /^##@/ { printf "\n\033[1;33m%s\033[0m\n", substr($$0, 5) } \
	  /^[a-zA-Z_-]+:.*?## / { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' \
	  $(MAKEFILE_LIST)
	@printf "\n"
	@printf "\033[1mExamples:\033[0m\n"
	@printf "  \033[32mmake add-service\033[0m    ALIAS=myapp PORT=8080 DESC='My Application'\n"
	@printf "  \033[32mmake delete-service\033[0m ALIAS=myapp\n"
	@printf "\n"
	@printf "  \033[90m# HOST_BUB / HOST_LAMOLABS: hostname (no domain) of an existing DNS entry\033[0m\n"
	@printf "  \033[90m# in the respective domain. Run 'make list-hosts' to see valid values.\033[0m\n"
	@printf "  \033[32mmake add-service\033[0m    ALIAS=myapp PORT=8080 DESC='My App' HOST_BUB=docker-host-02-svcs HOST_LAMOLABS=lamolabs-svcs\n"
	@printf "  \033[32mmake add-service\033[0m    ALIAS=myapp PORT=8080 DESC='My App' HOST_BUB=orangepi5-svcs     HOST_LAMOLABS=lamolabs-svcs\n"
	@printf "  \033[32mmake add-service\033[0m    ALIAS=myapp PORT=443  DESC='My App' HOST_BUB=docker-host-02-svcs SSL=true \033[90m# backend serves HTTPS\033[0m\n"
	@printf "  \033[32mmake delete-service\033[0m ALIAS=myapp HOST_BUB=docker-host-02-svcs HOST_LAMOLABS=lamolabs-svcs\n"
	@printf "\n"
	@printf "  \033[32mmake list-hosts\033[0m    \033[90m# show available HOST_BUB / HOST_LAMOLABS values\033[0m\n"
	@printf "  \033[32mmake dns-list\033[0m      \033[90m# list all DNS entries\033[0m\n"
	@printf "  \033[32mmake haproxy-list\033[0m  \033[90m# list all HAProxy backends\033[0m\n"
	@printf "\n"
	@printf "  \033[32mmake wg-provision\033[0m CONF=~/Downloads/protonvpn.conf KILL_SWITCH='192.168.7.6/32' KS_ALIAS=NordVPN_KS_Hosts\n"
	@printf "  \033[32mmake wg-provision\033[0m CONF=~/Downloads/protonvpn.conf KILL_SWITCH='192.168.7.6/32 192.168.7.7/32' TUNNEL=ProtonVPN02 IFACE=PROTONVPN2 LISTEN_PORT=51822 MONITOR_IP=9.9.9.9\n"
	@printf "  \033[32mmake wg-dry-run\033[0m   CONF=~/Downloads/protonvpn.conf KILL_SWITCH='192.168.7.6/32'\n"
	@printf "  \033[32mmake wg-teardown\033[0m  KS_ALIAS=NordVPN_KS_Hosts \033[90m# remove rules, gateway, peer, NAT, and alias\033[0m\n"
	@printf "  \033[32mmake wg-status\033[0m    \033[90m# show tunnel and peer status\033[0m\n"
	@printf "\n"
	@printf "  \033[32mmake fw-alias-list\033[0m                                         \033[90m# list all firewall aliases\033[0m\n"
	@printf "  \033[32mmake fw-alias-add-host\033[0m    NAME=NordVPN_KS_Hosts HOST=192.168.7.7 DETAIL='pi-vpn2'\n"
	@printf "  \033[32mmake fw-alias-remove-host\033[0m NAME=NordVPN_KS_Hosts HOST=192.168.7.7\n"
	@printf "\n"
	@printf "For CLI help: \033[36mmake cli-help\033[0m\n\n"

##@ Service Management

# Usage: make add-service ALIAS=myapp PORT=5431 DESC="My App - https://github.com/..."
add-service: ## Add complete service (ALIAS= PORT= DESC= [SSL=true]) - DNS + HAProxy
	@if [ -z "$(ALIAS)" ] || [ -z "$(PORT)" ] || [ -z "$(DESC)" ]; then \
		echo "Error: ALIAS, PORT, and DESC are required"; \
		echo "Usage: make add-service ALIAS=service-name PORT=8080 DESC='Service description' [HOST_BUB=backend-host] [HOST_LAMOLABS=frontend-host] [SSL=true]"; \
		exit 1; \
	fi
	@printf "\n\033[1;36m[1/4]\033[0m DNS alias \033[36m$(ALIAS).bub.lan\033[0m → \033[36m$(HOST_BUB).bub.lan\033[0m \033[90m(backend)\033[0m\n"
	@docker-compose run --rm opnsense-cli alias:add --host $(HOST_BUB) --domain bub.lan --alias-host $(ALIAS) --alias-domain bub.lan --description "$(DESC)" 2>/dev/null || true
	@printf "\n\033[1;36m[2/4]\033[0m DNS alias \033[36m$(ALIAS).lamolabs.org\033[0m → \033[36m$(HOST_LAMOLABS).lamolabs.org\033[0m \033[90m(frontend)\033[0m\n"
	@docker-compose run --rm opnsense-cli alias:add --host $(HOST_LAMOLABS) --domain lamolabs.org --alias-host $(ALIAS) --alias-domain lamolabs.org --description "$(DESC)" 2>/dev/null || true
	@printf "\n\033[1;36m[3/4]\033[0m HAProxy backend \033[36m$(ALIAS)\033[0m → \033[36m$(ALIAS).bub.lan:$(PORT)\033[0m$(if $(filter true,$(SSL)), \033[33m[SSL]\033[0m)\n"
	@docker-compose run --rm opnsense-cli haproxy:add --name $(ALIAS) --server-name $(ALIAS).bub.lan --server-address $(ALIAS).bub.lan --server-port $(PORT) $(if $(filter true,$(SSL)),--ssl) 2>/dev/null
	@printf "\n\033[1;36m[4/4]\033[0m Frontend route \033[36m$(ALIAS).lamolabs.org\033[0m → \033[36m$(ALIAS)\033[0m backend\n"
	@docker-compose run --rm opnsense-cli haproxy:route-add --frontend HomePrivateServers --acl $(ALIAS) --hostname $(ALIAS).lamolabs.org --backend $(ALIAS) 2>/dev/null
	@printf "\n\033[1;32m✓ Service \033[1;37m$(ALIAS)\033[1;32m fully configured!\033[0m\n"
	@printf "\n  \033[1mDNS:\033[0m\n"
	@printf "    \033[90m-\033[0m \033[36m$(ALIAS).bub.lan\033[0m \033[90m→ $(HOST_BUB).bub.lan (backend)\033[0m\n"
	@printf "    \033[90m-\033[0m \033[36m$(ALIAS).lamolabs.org\033[0m \033[90m→ $(HOST_LAMOLABS).lamolabs.org (HAProxy frontend)\033[0m\n"
	@printf "\n  \033[1mHAProxy:\033[0m\n"
	@printf "    \033[90m-\033[0m Backend: \033[36m$(ALIAS)\033[0m \033[90m→\033[0m \033[36m$(ALIAS).bub.lan:$(PORT)\033[0m\n"
	@printf "    \033[90m-\033[0m Frontend \033[33mHomePrivateServers\033[0m: \033[36m$(ALIAS).lamolabs.org\033[0m \033[90m→\033[0m \033[36m$(ALIAS)\033[0m backend\n"
	@printf "\n  \033[1mAccess via:\033[0m \033[1;32mhttps://$(ALIAS).lamolabs.org\033[0m\n\n"

# Usage: make delete-service ALIAS=myapp [HOST_BUB=docker-host-01-svcs] [HOST_LAMOLABS=lamolabs-svcs]
delete-service: ## Remove complete service (ALIAS=) - DNS + HAProxy (reverse of add-service)
	@if [ -z "$(ALIAS)" ]; then \
		echo "Error: ALIAS is required"; \
		echo "Usage: make delete-service ALIAS=service-name [HOST_BUB=backend-host] [HOST_LAMOLABS=frontend-host]"; \
		exit 1; \
	fi
	@printf "\n\033[1;36m[1/4]\033[0m Frontend route \033[36m$(ALIAS).lamolabs.org\033[0m\n"
	@docker-compose run --rm opnsense-cli haproxy:route-delete --frontend HomePrivateServers --acl $(ALIAS) 2>/dev/null || true
	@printf "\n\033[1;36m[2/4]\033[0m HAProxy backend \033[36m$(ALIAS)\033[0m\n"
	@docker-compose run --rm opnsense-cli haproxy:delete --name $(ALIAS) 2>/dev/null || true
	@printf "\n\033[1;36m[3/4]\033[0m DNS alias \033[36m$(ALIAS).lamolabs.org\033[0m → \033[36m$(HOST_LAMOLABS).lamolabs.org\033[0m \033[90m(frontend)\033[0m\n"
	@docker-compose run --rm opnsense-cli alias:delete --host $(HOST_LAMOLABS) --domain lamolabs.org --alias-host $(ALIAS) --alias-domain lamolabs.org 2>/dev/null || true
	@printf "\n\033[1;36m[4/4]\033[0m DNS alias \033[36m$(ALIAS).bub.lan\033[0m → \033[36m$(HOST_BUB).bub.lan\033[0m \033[90m(backend)\033[0m\n"
	@docker-compose run --rm opnsense-cli alias:delete --host $(HOST_BUB) --domain bub.lan --alias-host $(ALIAS) --alias-domain bub.lan 2>/dev/null || true
	@printf "\n\033[1;32m✓ Service \033[1;37m$(ALIAS)\033[1;32m removed!\033[0m\n"
	@printf "\n  \033[1mDeleted:\033[0m\n"
	@printf "    \033[90m-\033[0m Frontend ACL+Action: \033[36m$(ALIAS).lamolabs.org\033[0m\n"
	@printf "    \033[90m-\033[0m HAProxy backend: \033[36m$(ALIAS)\033[0m\n"
	@printf "    \033[90m-\033[0m DNS alias: \033[36m$(ALIAS).lamolabs.org\033[0m\n"
	@printf "    \033[90m-\033[0m DNS alias: \033[36m$(ALIAS).bub.lan\033[0m\n\n"

list-hosts: ## Show valid HOST_BUB and HOST_LAMOLABS values (queries live DNS)
	@echo "Querying OPNsense DNS for registered hosts..."
	@echo ""
	@echo "Backend hosts  (HOST_BUB candidates — bub.lan domain):"
	@result=$$(docker-compose run --rm opnsense-cli list 2>/dev/null \
	  | grep -E '^\s*[0-9]+\.' | grep '\.bub\.lan' \
	  | sed 's/.*[0-9]\+\. //; s/\.bub\.lan//'); \
	if [ -z "$$result" ]; then echo "  (none found)"; else echo "$$result" | sed 's/^/  /'; fi
	@echo ""
	@echo "Frontend hosts (HOST_LAMOLABS candidates — lamolabs.org domain):"
	@result=$$(docker-compose run --rm opnsense-cli list 2>/dev/null \
	  | grep -E '^\s*[0-9]+\.' | grep '\.lamolabs\.org' \
	  | sed 's/.*[0-9]\+\. //; s/\.lamolabs\.org//'); \
	if [ -z "$$result" ]; then echo "  (none found)"; else echo "$$result" | sed 's/^/  /'; fi
	@echo ""
	@echo "Usage:"
	@echo "  make add-service ALIAS=myapp PORT=8080 DESC='My App' HOST_BUB=<value-above> HOST_LAMOLABS=<value-above>"

##@ DNS

dns-list: ## List all DNS entries
	@docker-compose run --rm opnsense-cli list 2>/dev/null

dns-add: ## Add DNS entry (HOST= DOMAIN= IP= [DESC=])
	@if [ -z "$(HOST)" ] || [ -z "$(DOMAIN)" ] || [ -z "$(IP)" ]; then \
		echo "Error: HOST, DOMAIN, and IP are required"; \
		echo "Usage: make dns-add HOST=myserver DOMAIN=local.lan IP=192.168.1.100 [DESC='Description']"; \
		exit 1; \
	fi
	@docker-compose run --rm opnsense-cli add --host $(HOST) --domain $(DOMAIN) --ip $(IP) $(if $(DESC),--description "$(DESC)") 2>/dev/null

dns-update: ## Update DNS entry (HOST= DOMAIN= [IP=] [DESC=])
	@if [ -z "$(HOST)" ] || [ -z "$(DOMAIN)" ]; then \
		echo "Error: HOST and DOMAIN are required"; \
		echo "Usage: make dns-update HOST=myserver DOMAIN=local.lan [IP=192.168.1.101] [DESC='Description']"; \
		exit 1; \
	fi
	@docker-compose run --rm opnsense-cli update --host $(HOST) --domain $(DOMAIN) $(if $(IP),--ip $(IP)) $(if $(DESC),--description "$(DESC)") 2>/dev/null

dns-delete: ## Delete DNS entry (HOST= DOMAIN=)
	@if [ -z "$(HOST)" ] || [ -z "$(DOMAIN)" ]; then \
		echo "Error: HOST and DOMAIN are required"; \
		echo "Usage: make dns-delete HOST=myserver DOMAIN=local.lan"; \
		exit 1; \
	fi
	@docker-compose run --rm opnsense-cli delete --host $(HOST) --domain $(DOMAIN) 2>/dev/null

dns-alias-add: ## Add DNS alias (HOST= DOMAIN= ALIAS= ALIAS_DOMAIN= [DESC=])
	@if [ -z "$(HOST)" ] || [ -z "$(DOMAIN)" ] || [ -z "$(ALIAS)" ] || [ -z "$(ALIAS_DOMAIN)" ]; then \
		echo "Error: HOST, DOMAIN, ALIAS, and ALIAS_DOMAIN are required"; \
		echo "Usage: make dns-alias-add HOST=myserver DOMAIN=local.lan ALIAS=www ALIAS_DOMAIN=local.lan [DESC='Description']"; \
		exit 1; \
	fi
	@docker-compose run --rm opnsense-cli alias:add --host $(HOST) --domain $(DOMAIN) --alias-host $(ALIAS) --alias-domain $(ALIAS_DOMAIN) $(if $(DESC),--description "$(DESC)") 2>/dev/null

dns-alias-delete: ## Delete DNS alias (HOST= DOMAIN= ALIAS= ALIAS_DOMAIN=)
	@if [ -z "$(HOST)" ] || [ -z "$(DOMAIN)" ] || [ -z "$(ALIAS)" ] || [ -z "$(ALIAS_DOMAIN)" ]; then \
		echo "Error: HOST, DOMAIN, ALIAS, and ALIAS_DOMAIN are required"; \
		echo "Usage: make dns-alias-delete HOST=myserver DOMAIN=local.lan ALIAS=www ALIAS_DOMAIN=local.lan"; \
		exit 1; \
	fi
	@docker-compose run --rm opnsense-cli alias:delete --host $(HOST) --domain $(DOMAIN) --alias-host $(ALIAS) --alias-domain $(ALIAS_DOMAIN) 2>/dev/null

# Usage: make add-dual-alias ALIAS=myapp DESC="My App - https://github.com/..."
add-dual-alias: ## Add alias to both bub.lan and lamolabs.org (ALIAS= DESC=)
	@if [ -z "$(ALIAS)" ] || [ -z "$(DESC)" ]; then \
		echo "Error: ALIAS and DESC are required"; \
		echo "Usage: make add-dual-alias ALIAS=service-name DESC='Service description'"; \
		exit 1; \
	fi
	@echo "Adding $(ALIAS) alias to docker-host-01-svcs.bub.lan..."
	@docker-compose run --rm opnsense-cli alias:add --host docker-host-01-svcs --domain bub.lan --alias-host $(ALIAS) --alias-domain bub.lan --description "$(DESC)" 2>/dev/null
	@echo "Adding $(ALIAS) alias to lamolabs-svcs.lamolabs.org..."
	@docker-compose run --rm opnsense-cli alias:add --host lamolabs-svcs --domain lamolabs.org --alias-host $(ALIAS) --alias-domain lamolabs.org --description "$(DESC)" 2>/dev/null

##@ HAProxy

haproxy-list: ## List all HAProxy backends
	@docker-compose run --rm opnsense-cli haproxy:list 2>/dev/null

haproxy-add: ## Add HAProxy backend (NAME= SERVER= PORT=)
	@if [ -z "$(NAME)" ] || [ -z "$(SERVER)" ] || [ -z "$(PORT)" ]; then \
		echo "Error: NAME, SERVER, and PORT are required"; \
		echo "Usage: make haproxy-add NAME=backend-name SERVER=server.domain.com PORT=8080"; \
		exit 1; \
	fi
	@docker-compose run --rm opnsense-cli haproxy:add --name $(NAME) --server-name $(SERVER) --server-address $(SERVER) --server-port $(PORT) $(if $(filter true,$(SSL)),--ssl) 2>/dev/null

haproxy-delete: ## Delete HAProxy backend (NAME=)
	@if [ -z "$(NAME)" ]; then \
		echo "Error: NAME is required"; \
		echo "Usage: make haproxy-delete NAME=backend-name"; \
		exit 1; \
	fi
	@docker-compose run --rm opnsense-cli haproxy:delete --name $(NAME) 2>/dev/null

##@ WireGuard / ProtonVPN

# Expand KILL_SWITCH='a/32 b/32' into repeated --kill-switch flags
_KS_FLAGS = $(foreach ks,$(KILL_SWITCH),--kill-switch $(ks))

# Common wg:provision flags derived from make variables
define _wg_flags
  --server-name "$(TUNNEL)" \
  --listen-port "$(LISTEN_PORT)" \
  --monitor-ip "$(MONITOR_IP)" \
  --lan-subnet "$(LAN_SUBNET)" \
  $(_KS_FLAGS) \
  $(if $(KS_ALIAS),--ks-alias "$(KS_ALIAS)")
endef

wg-status: ## Show WireGuard server and client status
	@node cli.js wg:status

wg-provision: ## Full zero-touch ProtonVPN setup (CONF= KILL_SWITCH='ip/32 ...' [TUNNEL=] [LISTEN_PORT=] [MONITOR_IP=] [LAN_SUBNET=])
	@if [ -z "$(CONF)" ]; then \
		echo "Error: CONF is required"; \
		echo "Usage: make wg-provision CONF=~/Downloads/protonvpn.conf KILL_SWITCH='192.168.7.6/32'"; \
		exit 1; \
	fi
	@node cli.js wg:provision "$(CONF)" $(call _wg_flags)

wg-apply: wg-provision ## Alias for wg-provision (backward compat)

wg-dry-run: ## Preview wg-provision without applying changes (same options as wg-provision)
	@if [ -z "$(CONF)" ]; then \
		echo "Error: CONF is required"; \
		echo "Usage: make wg-dry-run CONF=~/Downloads/protonvpn.conf KILL_SWITCH='192.168.7.6/32'"; \
		exit 1; \
	fi
	@node cli.js wg:provision "$(CONF)" $(call _wg_flags) --dry-run

wg-teardown: ## Remove WireGuard rules, NAT, gateway, and peer ([TUNNEL=ProtonVPN01] [KS_ALIAS=])
	@node cli.js wg:teardown \
	  --server-name "$(TUNNEL)" \
	  $(if $(KS_ALIAS),--ks-alias "$(KS_ALIAS)")

##@ NordVPN WireGuard

NORDVPN_TOKEN  ?=
NORDVPN_TUNNEL ?= NordVPNWG01
COUNTRY_ID     ?= 228
DRY_RUN       ?=
DELETE_TUNNEL ?=
BULK_FILE     ?=
CERT_NAME     ?=
CERT_FILE     ?=
KEY_FILE      ?=
CERT_TYPE     ?= server
EXPIRING      ?= 30
KEEP_LAST     ?=
OLDER_THAN    ?=
DOMAIN        ?=
DNS_HOOK      ?= dns_cf
MAC           ?=
IP            ?=
HOSTNAME_VAL  ?=

nordvpn-servers: ## List recommended NordVPN WireGuard servers ([COUNTRY_ID=228])
	@node cli.js nordvpn:servers --country-id "$(COUNTRY_ID)"

nordvpn-creds: ## Fetch NordVPN nordlynx_private_key and VPN credentials ([NORDVPN_TOKEN=] falls back to .env)
	@node cli.js nordvpn:creds $(if $(NORDVPN_TOKEN),--token "$(NORDVPN_TOKEN)")

nordvpn-rotate-wg: ## Rotate NordVPN WireGuard to lowest-load server ([COUNTRY_ID=228] [NORDVPN_TUNNEL=NordVPNWG01] [GW_NAME=NORDVPNWG_GW] [DRY_RUN=1] [FORCE=1])
	@node cli.js nordvpn:rotate-wg \
	  --country-id "$(COUNTRY_ID)" \
	  --server-name "$(NORDVPN_TUNNEL)" \
	  $(if $(GW_NAME),--gateway-name "$(GW_NAME)") \
	  $(if $(DRY_RUN),--dry-run) \
	  $(if $(FORCE),--force)

nordvpn-teardown-wg: ## Remove NordVPN WireGuard rules, NAT, gateway, peer ([NORDVPN_TUNNEL=NordVPNWG01] [DELETE_TUNNEL=1])
	@node cli.js nordvpn:teardown-wg \
	  --server-name "$(NORDVPN_TUNNEL)" \
	  $(if $(DELETE_TUNNEL),--delete-tunnel)

##@ Firewall Rules

# Shared vars (also used by alias targets below)
NAME   ?=
HOST   ?=
DETAIL ?=
TYPE   ?= host

# Rule-specific vars (prefixed with RULE_ to avoid collision with WireGuard defaults)
RULE_ID    ?=
RULE_TYPE  ?=
RULE_IFACE ?=
RULE_SRC   ?= any
RULE_SPORT ?=
RULE_DEST  ?= any
RULE_DPORT ?=
RULE_PROTO ?=
RULE_IPVER ?= inet
RULE_GW    ?=
RULE_TAG   ?=
RULE_DESC  ?=

fw-rule-list: ## List firewall rules ([FILTER=] [RULE_IFACE=lan|wan] [RULE_TYPE=pass|block])
	@node cli.js fw-rule:list \
	  $(if $(FILTER),--filter "$(FILTER)") \
	  $(if $(RULE_IFACE),--interface "$(RULE_IFACE)") \
	  $(if $(RULE_TYPE),--type "$(RULE_TYPE)")

fw-rule-add: ## Add a firewall rule (RULE_TYPE= RULE_IFACE= [RULE_SRC=any] [RULE_DEST=any] [RULE_PROTO=] [RULE_GW=] [RULE_DESC=])
	@if [ -z "$(RULE_TYPE)" ] || [ -z "$(RULE_IFACE)" ]; then \
		echo "Error: RULE_TYPE and RULE_IFACE are required"; \
		echo "Usage: make fw-rule-add RULE_TYPE=pass RULE_IFACE=lan RULE_SRC=MyAlias RULE_GW=NordVPN_WG_GWGrp RULE_DESC='My rule'"; \
		exit 1; \
	fi
	@node cli.js fw-rule:add \
	  --type "$(RULE_TYPE)" \
	  --interface "$(RULE_IFACE)" \
	  --source "$(RULE_SRC)" \
	  --destination "$(RULE_DEST)" \
	  --ip-version "$(RULE_IPVER)" \
	  $(if $(RULE_SPORT),--source-port "$(RULE_SPORT)") \
	  $(if $(RULE_DPORT),--dest-port "$(RULE_DPORT)") \
	  $(if $(RULE_PROTO),--protocol "$(RULE_PROTO)") \
	  $(if $(RULE_GW),--gateway "$(RULE_GW)") \
	  $(if $(RULE_TAG),--tag "$(RULE_TAG)") \
	  $(if $(RULE_DESC),--description "$(RULE_DESC)")

fw-rule-delete: ## Delete a firewall rule (RULE_ID= or RULE_DESC=)
	@if [ -z "$(RULE_ID)" ] && [ -z "$(RULE_DESC)" ]; then \
		echo "Error: RULE_ID or RULE_DESC is required"; \
		echo "Usage: make fw-rule-delete RULE_ID=<uuid>"; \
		echo "       make fw-rule-delete RULE_DESC='my rule description'"; \
		exit 1; \
	fi
	@node cli.js fw-rule:delete \
	  $(if $(RULE_ID),--id "$(RULE_ID)") \
	  $(if $(RULE_DESC),--description "$(RULE_DESC)")

fw-rule-update: ## Update a firewall rule (RULE_ID= or RULE_DESC=, then any of: RULE_TYPE= RULE_IFACE= RULE_SRC= RULE_DEST= RULE_PROTO= RULE_GW= ENABLE=1 DISABLE=1)
	@if [ -z "$(RULE_ID)" ] && [ -z "$(RULE_DESC)" ]; then \
		echo "Error: RULE_ID or RULE_DESC is required"; \
		exit 1; \
	fi
	@node cli.js fw-rule:update \
	  $(if $(RULE_ID),--id "$(RULE_ID)") \
	  $(if $(RULE_DESC),--description "$(RULE_DESC)") \
	  $(if $(RULE_TYPE),--type "$(RULE_TYPE)") \
	  $(if $(RULE_IFACE),--interface "$(RULE_IFACE)") \
	  $(if $(RULE_SRC),--source "$(RULE_SRC)") \
	  $(if $(RULE_DEST),--destination "$(RULE_DEST)") \
	  $(if $(RULE_PROTO),--protocol "$(RULE_PROTO)") \
	  $(if $(RULE_GW),--gateway "$(RULE_GW)") \
	  $(if $(ENABLE),--enable) \
	  $(if $(DISABLE),--disable)

##@ Firewall Aliases

fw-alias-list: ## List OPNsense firewall aliases ([FILTER=])
	@node cli.js fw-alias:list $(if $(FILTER),--filter "$(FILTER)")

fw-alias-create: ## Create or update a firewall alias (NAME= [TYPE=host] [HOST='ip1 ip2'] [DESC=])
	@if [ -z "$(NAME)" ]; then \
		echo "Error: NAME is required"; \
		echo "Usage: make fw-alias-create NAME=NordVPN_KS_Hosts HOST='192.168.7.6' DESC='NordVPN kill-switch hosts'"; \
		exit 1; \
	fi
	@node cli.js fw-alias:create --name "$(NAME)" --type "$(TYPE)" \
	  $(if $(DESC),--description "$(DESC)") \
	  $(foreach h,$(HOST),--host $(h))

fw-alias-add-host: ## Add a host to a firewall alias (NAME= HOST= [DETAIL=])
	@if [ -z "$(NAME)" ] || [ -z "$(HOST)" ]; then \
		echo "Error: NAME and HOST are required"; \
		echo "Usage: make fw-alias-add-host NAME=NordVPN_KS_Hosts HOST=192.168.7.7 DETAIL='pi-vpn2'"; \
		exit 1; \
	fi
	@node cli.js fw-alias:add-host --name "$(NAME)" --host "$(HOST)" $(if $(DETAIL),--detail "$(DETAIL)")

fw-alias-remove-host: ## Remove a host from a firewall alias (NAME= HOST=)
	@if [ -z "$(NAME)" ] || [ -z "$(HOST)" ]; then \
		echo "Error: NAME and HOST are required"; \
		echo "Usage: make fw-alias-remove-host NAME=NordVPN_KS_Hosts HOST=192.168.7.7"; \
		exit 1; \
	fi
	@node cli.js fw-alias:remove-host --name "$(NAME)" --host "$(HOST)"

fw-alias-delete: ## Delete a firewall alias (NAME=)
	@if [ -z "$(NAME)" ]; then \
		echo "Error: NAME is required"; \
		echo "Usage: make fw-alias-delete NAME=NordVPN_KS_Hosts"; \
		exit 1; \
	fi
	@node cli.js fw-alias:delete --name "$(NAME)"

##@ Bulk Operations

bulk-import: ## Import services/DNS/HAProxy from JSON or CSV (BULK_FILE= [DRY_RUN=1])
	@if [ -z "$(BULK_FILE)" ]; then \
		echo "Error: BULK_FILE is required"; \
		echo "Usage: make bulk-import BULK_FILE=services.json"; \
		echo "       make bulk-import BULK_FILE=services.json DRY_RUN=1"; \
		exit 1; \
	fi
	@node cli.js bulk:import "$(BULK_FILE)" $(if $(DRY_RUN),--dry-run)

OUT           ?= snapshot.json

bulk-export: ## Export DNS + HAProxy config to JSON ([OUT=snapshot.json])
	@node cli.js bulk:export --output "$(OUT)"
	@echo "Re-import with: make bulk-import BULK_FILE=$(OUT)"

##@ DHCP

dhcp-list: ## List DHCP static mappings ([IFACE=lan] [FILTER=])
	@node cli.js dhcp:list \
	  $(if $(IFACE),--interface "$(IFACE)") \
	  $(if $(FILTER),--filter "$(FILTER)")

dhcp-add: ## Add a DHCP static mapping (IFACE= MAC= [IP=] [HOSTNAME_VAL=] [DESC=])
	@if [ -z "$(IFACE)" ] || [ -z "$(MAC)" ]; then \
		echo "Error: IFACE and MAC are required"; \
		echo "Usage: make dhcp-add IFACE=lan MAC=aa:bb:cc:dd:ee:ff IP=192.168.7.50 HOSTNAME_VAL=mydevice"; \
		exit 1; \
	fi
	@node cli.js dhcp:add \
	  --interface "$(IFACE)" \
	  --mac "$(MAC)" \
	  $(if $(IP),--ip "$(IP)") \
	  $(if $(HOSTNAME_VAL),--hostname "$(HOSTNAME_VAL)") \
	  $(if $(DESC),--description "$(DESC)")

dhcp-update: ## Update a DHCP static mapping (IFACE= MAC= [IP=] [HOSTNAME_VAL=] [DESC=])
	@if [ -z "$(IFACE)" ] || [ -z "$(MAC)" ]; then \
		echo "Error: IFACE and MAC are required"; \
		exit 1; \
	fi
	@node cli.js dhcp:update \
	  --interface "$(IFACE)" \
	  --mac "$(MAC)" \
	  $(if $(IP),--ip "$(IP)") \
	  $(if $(HOSTNAME_VAL),--hostname "$(HOSTNAME_VAL)") \
	  $(if $(DESC),--description "$(DESC)")

dhcp-delete: ## Delete a DHCP static mapping (IFACE= MAC=)
	@if [ -z "$(IFACE)" ] || [ -z "$(MAC)" ]; then \
		echo "Error: IFACE and MAC are required"; \
		echo "Usage: make dhcp-delete IFACE=lan MAC=aa:bb:cc:dd:ee:ff"; \
		exit 1; \
	fi
	@node cli.js dhcp:delete --interface "$(IFACE)" --mac "$(MAC)"

##@ Certificates

cert-list: ## List certificates with expiry info ([FILTER=] [EXPIRING=<days>])
	@node cli.js cert:list \
	  $(if $(FILTER),--filter "$(FILTER)") \
	  $(if $(EXPIRING),--expiring "$(EXPIRING)")

cert-import: ## Import a cert+key pair (CERT_NAME= CERT_FILE= KEY_FILE= [CERT_TYPE=server|user])
	@if [ -z "$(CERT_NAME)" ] || [ -z "$(CERT_FILE)" ] || [ -z "$(KEY_FILE)" ]; then \
		echo "Error: CERT_NAME, CERT_FILE, and KEY_FILE are required"; \
		echo "Usage: make cert-import CERT_NAME=mysite CERT_FILE=mysite.crt KEY_FILE=mysite.key"; \
		exit 1; \
	fi
	@node cli.js cert:import \
	  --name "$(CERT_NAME)" \
	  --cert "$(CERT_FILE)" \
	  --key  "$(KEY_FILE)"

cert-delete: ## Delete a certificate (CERT_NAME=)
	@if [ -z "$(CERT_NAME)" ]; then \
		echo "Error: CERT_NAME is required"; \
		echo "Usage: make cert-delete CERT_NAME=mysite"; \
		exit 1; \
	fi
	@node cli.js cert:delete --name "$(CERT_NAME)"

cert-check: ## Exit 1 if any cert expires within EXPIRING days — for monitoring (default: 30)
	@node cli.js cert:check --expiring "$(EXPIRING)"

cert-renew-wildcard: ## Renew wildcard cert via acme.sh and import into OPNsense (DOMAIN= CERT_NAME= [DNS_HOOK=dns_cf])
	@if [ -z "$(DOMAIN)" ] || [ -z "$(CERT_NAME)" ]; then \
		echo "Error: DOMAIN and CERT_NAME are required"; \
		echo "Usage: make cert-renew-wildcard DOMAIN=example.com CERT_NAME=wildcard-example"; \
		exit 1; \
	fi
	@DOMAIN="$(DOMAIN)" CERT_NAME="$(CERT_NAME)" DNS_HOOK="$(DNS_HOOK)" \
	  sh scripts/renew-wildcard-cert.sh

##@ Configuration History

config-history: ## List OPNsense config history (note: falls back to web UI URL on 26.x)
	@node cli.js config:history $(if $(LIMIT),--limit "$(LIMIT)")

config-history-prune: ## Prune old config history revisions (OLDER_THAN=<days> or KEEP_LAST=<n>)
	@if [ -z "$(OLDER_THAN)" ] && [ -z "$(KEEP_LAST)" ]; then \
		echo "Error: OLDER_THAN or KEEP_LAST is required"; \
		echo "Usage: make config-history-prune OLDER_THAN=30   # delete revisions older than 30 days"; \
		echo "       make config-history-prune KEEP_LAST=20    # keep 20 most recent, delete rest"; \
		exit 1; \
	fi
	@node cli.js config:history-prune \
	  $(if $(OLDER_THAN),--older-than "$(OLDER_THAN)") \
	  $(if $(KEEP_LAST),--keep-last "$(KEEP_LAST)")

PRUNE_SCHEDULE ?= 0 3 * * *
PRUNE_LOG      ?= /tmp/opnsense-config-prune.log

config-history-schedule: ## Install a daily cron to auto-prune config history (KEEP_LAST=20 [OLDER_THAN=] [PRUNE_SCHEDULE="0 3 * * *"])
	@JOB="$(PRUNE_SCHEDULE) cd $(CURDIR) && KEEP_LAST=$(KEEP_LAST) OLDER_THAN=$(OLDER_THAN) LOG_FILE=$(PRUNE_LOG) sh scripts/prune-config-history.sh"; \
	( crontab -l 2>/dev/null | grep -v 'prune-config-history'; echo "$$JOB" ) | crontab -
	@echo "Installed cron: $(PRUNE_SCHEDULE)"
	@echo "Logs: $(PRUNE_LOG)"
	@echo "Run 'make config-history-cron-status' to verify"

config-history-unschedule: ## Remove the config history prune cron job
	@crontab -l 2>/dev/null | grep -v 'prune-config-history' | crontab - || true
	@echo "Removed config history prune cron job"

config-history-cron-status: ## Show current config history prune cron job (if any)
	@crontab -l 2>/dev/null | grep 'prune-config-history' || echo "(no config history prune cron installed)"

##@ Infrastructure

build: ## Build the Docker image
	docker-compose build

test-api: ## Test OPNsense API connectivity
	@echo "Testing OPNsense API connection..."
	@docker-compose run --rm --entrypoint sh opnsense-cli -c 'echo "Host: $$OPNSENSE_HOST" && echo "Testing: $$OPNSENSE_HOST/api/core/firmware/status" && echo "" && apk add --quiet curl > /dev/null 2>&1 && RESPONSE=$$(curl -s -k -w "\n%{http_code}" -u "$$OPNSENSE_API_KEY:$$OPNSENSE_API_SECRET" $$OPNSENSE_HOST/api/core/firmware/status) && HTTP_CODE=$$(echo "$$RESPONSE" | tail -n1) && BODY=$$(echo "$$RESPONSE" | head -n-1) && echo "$$BODY" | head -20 && echo "" && if [ "$$HTTP_CODE" = "200" ]; then echo "✓ API is accessible!"; else echo "✗ API returned HTTP $$HTTP_CODE"; echo ""; echo "Check: OPNSENSE_HOST, OPNSENSE_API_KEY, OPNSENSE_API_SECRET in .env"; echo "Enable API user at: System → Access → Users → edit user → API Keys"; exit 1; fi'

check-version: ## Check OPNsense firmware version
	@echo "Checking OPNsense version..."
	@docker-compose run --rm --entrypoint sh opnsense-cli -c 'apk add --quiet curl > /dev/null 2>&1 && echo "Firmware status:" && curl -s -k -u "$$OPNSENSE_API_KEY:$$OPNSENSE_API_SECRET" $$OPNSENSE_HOST/api/core/firmware/status | head -5 && echo "" && echo "API connectivity: OK"'

cli-help: ## Show CLI command help (--help output)
	docker-compose run --rm opnsense-cli --help

clean: ## Clean up Docker resources
	docker-compose down -v
