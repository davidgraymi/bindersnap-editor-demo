# NAT path for Lambda's outbound public-internet traffic.
#
# Lambda runs inside the VPC so it can reach Aurora and Gitea privately.
# The only outbound public destination is api.stripe.com (checkout session
# creation, billing portal session creation, and a handful of webhook
# reconcile calls — see issue #224 plan-verification thread for the audit).
#
# Rather than provisioning a NAT Gateway (~$32/mo) or a dedicated NAT
# instance (~$3/mo on t4g.nano), we route Lambda's egress through the
# existing Gitea EC2 host. It already has a public IP, is already in a
# public subnet, and is already running. Cost: $0.
#
# Tradeoff: when the Gitea host is down, Lambda also can't reach Stripe.
# At solo-dev volume this is acceptable because "Gitea down" already means
# "the application is down" — the editor and the document store both
# depend on Gitea.
#
# Mechanism:
#
#   1. Configure the Gitea instance for IP forwarding (one-time, via
#      user-data in infra/compute/user-data.sh.tftpl):
#
#        echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.d/99-nat.conf
#        sysctl --system
#        iptables -t nat -A POSTROUTING -s <lambda_subnet_cidr> \
#          -o eth0 -j MASQUERADE
#        iptables-save > /etc/iptables/rules.v4
#
#      The exact subnet CIDR is parameterized; the rule lives on the host
#      so the host owns its own iptables state.
#
#   2. Disable source/dest check on the Gitea ENI. EC2 instances drop
#      packets they receive that aren't addressed to themselves unless
#      this is set, which would defeat the NAT.
#
#        aws_network_interface_attachment ... source_dest_check = false
#
#      (Or modify the existing ENI in infra/compute/.)
#
#   3. Add a route in the Lambda subnets' route table sending
#      0.0.0.0/0 to the Gitea instance's primary network interface:
#
#        aws_route.lambda_egress_to_gitea_eni
#
#      destination_cidr_block = "0.0.0.0/0"
#      network_interface_id   = <gitea_primary_eni_id>
#
# Security group considerations:
#   Lambda's SG egress allows 0.0.0.0/0 on 443 (so packets reach the NAT).
#   Gitea's SG must allow ingress from the Lambda subnet for return-path
#   processing — but since the iptables MASQUERADE conntrack rewrites the
#   src to Gitea's own IP, return packets from Stripe arrive on Gitea's
#   public ENI and the kernel handles the rest. No new ingress rule on
#   the Stripe-facing path is needed.
#
# Failure-mode notes:
#   - If Gitea is replaced (instance ID changes), the route in the Lambda
#     subnet must be updated to point at the new ENI. Worth a small
#     post-replace script in #223's host CLI.
#   - The iptables rule is idempotent on the user-data path; re-running
#     bootstrap is safe.
#
# TODO(#224):
#   aws_route.lambda_egress_via_gitea       # 0.0.0.0/0 → gitea_eni_id
#   data.aws_network_interface.gitea_primary
#   modification of infra/compute/ to disable source/dest check on the
#     Gitea ENI and add the IP-forwarding/iptables block to user-data.
