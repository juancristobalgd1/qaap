# PLAN 3 deployment requirements

## Tenant egress allowlist

Tenant worker and backend networks now use a versioned Docker bridge with `Internal: true`. Direct
outbound connections from agent sandboxes are blocked. To enable approved npm, GitHub, and model
provider access, build the dedicated proxy image and set the image name in the environment used by
Qaap:

```sh
docker build -t qaap-tenant-egress:plan3-2026-10 deploy/qaap-tenant-egress
export QAAP_TENANT_EGRESS_PROXY_IMAGE=qaap-tenant-egress:plan3-2026-10
```

Use an immutable image tag and make that image available on every Docker node that can host a tenant.

The orchestrator creates one proxy container per tenant, attaches it to that tenant's internal
bridge and to the managed `qaap-tenant-egress-uplink` bridge, and supplies `HTTP_PROXY`/`HTTPS_PROXY`
to the tenant. It never shares a proxy container across tenant networks. The Squid policy allows
only domains in `deploy/qaap-tenant-egress/allowed-domains.txt`, ports 80/443, and denies
private/special destination ranges. Add a provider domain to that list only after approving it.

The deployment environment must validate that proxy containers can reach the public Docker bridge
while tenant containers cannot bypass them. Before rollout, verify from a tenant container that
`curl --noproxy '*' https://example.com` fails, `curl https://registry.npmjs.org` succeeds through
the proxy, and a provider request succeeds. The host must keep tenant bridge traffic from forwarding
directly to external interfaces; apply the platform's firewall policy as defense in depth. These
checks require the production Docker daemon and host firewall, so they cannot be validated from this
worktree.

The bridge name includes `v2` so existing egress-capable tenant containers are recreated onto the
internal network. After rollout, inspect and remove unused legacy `qaap-net-*` bridge networks.

## Rootless tenant ACL validation

The tenant backend image now includes `setpriv` and POSIX ACL tools. In rootless Docker, validate on
the target filesystem that `setfacl` can grant uid 1001 access to one mounted
`/workspace/repos/users/<login>` tree and that new files inherit the ACL. Confirm a uid-1001 task can
create/edit files in its own tree while sibling login trees remain inaccessible. This requires the
production rootless UID map and bind-mount filesystem; the unit specs validate the command scope but
cannot exercise the host ACL mapping.
