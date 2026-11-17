import type * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as resolver from 'aws-cdk-lib/aws-route53resolver';
import { Construct } from 'constructs';
import { BACKUP_REGION, HOME_REGION, internalZoneName } from './config.js';

export interface DnsFirewallProps {
  domain: string;
  vpc: ec2.IVpc;
}

export const PROVIDER_DOMAINS = [
  'api.anthropic.com',
  'api.openai.com',
  'api.x.ai',
  'graph.microsoft.com',
  'login.microsoftonline.com',
  '*.sharepoint.com',
  '*.stack.tryrelevance.com',
  'api.elevenlabs.io',
  'acme-v02.api.letsencrypt.org',
];

export const AWS_DOMAINS = [
  ...['ssm', 'ssmmessages', 'ec2messages', 'logs', 'monitoring', 'sts', 'route53'].map(
    (service) => `${service}.${HOME_REGION}.amazonaws.com`,
  ),
  'route53.amazonaws.com',
  `s3.${BACKUP_REGION}.amazonaws.com`,
  `*.s3.${BACKUP_REGION}.amazonaws.com`,
  `s3.${HOME_REGION}.amazonaws.com`,
  `*.s3.${HOME_REGION}.amazonaws.com`,
  '*.ec2.internal',
  'instance-data',
];

export const UPDATES_LIST_NAME = 'pressroom-updates';

export class DnsFirewall extends Construct {
  readonly allowedDomains: string[];

  constructor(scope: Construct, id: string, props: DnsFirewallProps) {
    super(scope, id);

    this.allowedDomains = [
      ...PROVIDER_DOMAINS,
      ...AWS_DOMAINS,
      internalZoneName(props.domain),
      `*.${internalZoneName(props.domain)}`,
    ];
    const allowed = new resolver.CfnFirewallDomainList(this, 'Allowed', {
      name: 'pressroom-allowed',
      domains: this.allowedDomains,
    });
    // Kept empty; infra/scripts/registries.sh fills it only while an update runs.
    const updates = new resolver.CfnFirewallDomainList(this, 'Updates', {
      name: UPDATES_LIST_NAME,
    });
    const everything = new resolver.CfnFirewallDomainList(this, 'Everything', {
      name: 'pressroom-everything',
      domains: ['*'],
    });

    const ruleGroup = new resolver.CfnFirewallRuleGroup(this, 'Rules', {
      name: 'pressroom-egress',
      firewallRules: [
        // Graph, Entra sign-in and Relevance CNAME to CDN and Traffic Manager names we do not list.
        {
          priority: 100,
          firewallDomainListId: allowed.attrId,
          action: 'ALLOW',
          firewallDomainRedirectionAction: 'TRUST_REDIRECTION_DOMAIN',
        },
        {
          priority: 200,
          firewallDomainListId: updates.attrId,
          action: 'ALLOW',
          firewallDomainRedirectionAction: 'TRUST_REDIRECTION_DOMAIN',
        },
        {
          priority: 300,
          firewallDomainListId: everything.attrId,
          action: 'BLOCK',
          blockResponse: 'NXDOMAIN',
        },
      ],
    });
    new resolver.CfnFirewallRuleGroupAssociation(this, 'Association', {
      firewallRuleGroupId: ruleGroup.attrId,
      vpcId: props.vpc.vpcId,
      priority: 101,
      name: 'pressroom-egress',
    });
    new resolver.CfnFirewallConfig(this, 'Config', {
      resourceId: props.vpc.vpcId,
      firewallFailOpen: 'DISABLED',
    });
  }
}
