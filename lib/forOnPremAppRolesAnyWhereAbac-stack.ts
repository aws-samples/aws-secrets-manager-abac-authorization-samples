// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps, Tags, CfnResource, Arn} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PcaStackForRolesAnywhere } from './forOnPremAppRolesAnyWherePca-stack';
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { NagSuppressions } from 'cdk-nag';

interface tagConfig {
  name: string,
  appid: string,
  appfunc: string,
  appenv: string,
  dataclassification: string
}

// todo: interface for PCA DN

const tagconfig: tagConfig = require('../configs/tagconfig.json');

export class RolesanywhereabacStack extends Stack {

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Creating a root PCA //

    const privateCertificateAuthorityArnExportName = new PcaStackForRolesAnywhere(this,
      'PrivateInternalCertificateAuthority',
      {
        rootDomain: "roles.anywhere.rootca",
      }
    );

    // Create an IAM managed policy powered by ABAC to allow Secret access -- //

    const conditionToMatchResourceTagWithPrincipalTag = {
      "StringEquals": {
          "secretsmanager:ResourceTag/appfunc": "${aws:PrincipalTag/appfunc}",
          "secretsmanager:ResourceTag/appenv": "${aws:PrincipalTag/appenv}",
          "secretsmanager:ResourceTag/appid": "${aws:PrincipalTag/appid}"
      }
    };
     
    const managedPolicy = new iam.ManagedPolicy(this, 'managed-policy-id', {
      description: 'ABAC IAM Policy that will allows Secret access for ' + tagconfig.appid,
      statements: [
        new iam.PolicyStatement({
          sid: 'AccessBasedOnResourceTags',
          effect: iam.Effect.ALLOW,
          actions: [
            'secretsmanager:GetSecretValue',
            'secretsmanager:PutSecretValue',
            'secretsmanager:UpdateSecret',
            'secretsmanager:DeleteSecret',
          ],
          resources: ["*"],
          conditions: conditionToMatchResourceTagWithPrincipalTag
        })
      ],
    });

    // Create a role with specific PrincipalTag to allow secret fetch // 
    
    const onPremAppRole = new iam.CfnRole(this, 'onPremAppRole', {
      description: 'Role that grants secrets fetch powered by ABAC', 
      assumeRolePolicyDocument: new iam.PolicyDocument({
        statements: [
            new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW, 
                    principals: [
                        new iam.ServicePrincipal("rolesanywhere.amazonaws.com"),                     ], 
                    actions: [
                        "sts:AssumeRole", 
                        "sts:TagSession",
                        "sts:SetSourceIdentity",
                    ], 
             }),
          ],
        }),
      managedPolicyArns: [managedPolicy.managedPolicyArn]
    });
    
    Tags.of(onPremAppRole).add('appid', tagconfig.appid);
    Tags.of(onPremAppRole).add('appfunc', tagconfig.appfunc);
    Tags.of(onPremAppRole).add('appenv', tagconfig.appenv);

    // -- IAM Role Anywhere is not supported in CDK right now -- //

    const rolesAnywhereTrustAnchor = new CfnResource(this, 'TrustAnchor', {
      type: 'AWS::RolesAnywhere::TrustAnchor',
      properties: {
          Name: 'onPremAppTrustAnchor',
          Enabled: true,
          Source: {
            SourceData: {AcmPcaArn: 
              privateCertificateAuthorityArnExportName.certificateAuthority.certificateAuthorityArn
            },
            SourceType: "AWS_ACM_PCA"
          }
       },
    });
    rolesAnywhereTrustAnchor.node.addDependency(privateCertificateAuthorityArnExportName);

    const rolesAnywhereProfile = new CfnResource(this, 'rolesAnywhereProfile', {
      type: 'AWS::RolesAnywhere::Profile',
      properties: {
          Name: "onPremAppProfile",
          Enabled: true,
          DurationSeconds: 900,
          ManagedPolicyArns: [managedPolicy.managedPolicyArn],
          RoleArns: [onPremAppRole.attrArn],
        },
      });
    rolesAnywhereProfile.addDependsOn(onPremAppRole);

    // Adding resources to SSM parameter store
    
    const onPremAppRoleSsmParam = new ssm.StringParameter(this, 'IAM Role ARN StringParameter', {
      description: 'SSM Parameter to store PCA ARN for' + tagconfig.appid,
      parameterName: "/" + tagconfig.appid + "/" + tagconfig.appfunc + "/" + tagconfig.appenv + "/" 
                      + tagconfig.name + "-onPremAppRoleSsmParam",
      simpleName: false,
      stringValue: onPremAppRole.attrArn,
    });
    onPremAppRoleSsmParam.node.addDependency(onPremAppRole);

    const pcaArnSsmParam = new ssm.StringParameter(this, 'PCA ARN StringParameter', {
      description: 'SSM Parameter to store PCA ARN for' + tagconfig.appid,
      parameterName: "/" + tagconfig.appid + "/" + tagconfig.appfunc + "/" + tagconfig.appenv + "/" 
                      + tagconfig.name + "-pcaArnSsmParam",
      simpleName: false,
      stringValue: privateCertificateAuthorityArnExportName.certificateAuthority.certificateAuthorityArn,
    });
    pcaArnSsmParam.node.addDependency(privateCertificateAuthorityArnExportName);

    const rolesAnywhereTrustAnchorSsmParam  = new ssm.StringParameter(this, 'rolesAnywhereTrustAnchor StringParameter', {
      description: 'SSM Parameter to store Trust Anchor ARN for' + tagconfig.appid,
      parameterName: "/" + tagconfig.appid + "/" + tagconfig.appfunc + "/" + tagconfig.appenv + "/" 
                    + tagconfig.name + "-rolesAnywhereTrustAnchorSsmParam",
      simpleName: false,
      stringValue: rolesAnywhereTrustAnchor.getAtt('TrustAnchorArn').toString(),
    });
    rolesAnywhereTrustAnchorSsmParam.node.addDependency(rolesAnywhereTrustAnchor);

    const rolesAnywhereProfileSsmParam  = new ssm.StringParameter(this, 'rolesAnywhereProfile StringParameter', {
      description: 'SSM Parameter to store Roles Anywhere Profile ARN for' + tagconfig.appid,
      parameterName: "/" + tagconfig.appid + "/" + tagconfig.appfunc + "/" + tagconfig.appenv + "/" 
                    + tagconfig.name + "-rolesAnywhereProfileSsmParam",
      simpleName: false,
      stringValue: rolesAnywhereProfile.getAtt('ProfileArn').toString(),
    });
    rolesAnywhereProfileSsmParam.node.addDependency(rolesAnywhereProfile);

    // Common cdk-nag suppressions
    
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-S1',
        reason: 'This Finding is disabled as its flagging for access logging for the logging bucket.'
      },
      {
        id: 'AwsSolutions-S2',
        reason: 'This Finding is for CRL bucket which needs read access from public.'
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Solution is using ABAC to achieve fine grained access control.'
      },

    ]);
  }
}