// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps,Tags } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import {Key} from 'aws-cdk-lib/aws-kms';
import * as iam from "aws-cdk-lib/aws-iam";
import { newVpcAndEndpoints } from './commonNetworkandEndpoint-stack';
import { NagSuppressions } from 'cdk-nag';

interface tagConfig {
  name: string,
  appid: string,
  appfunc: string,
  appenv: string,
  dataclassification: string
}

const tagconfig: tagConfig = require('../configs/tagconfig.json');

export class commonSecretsAndIamPolicyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // -- 1. Create a CMK for Secrets Manager -- //

    const kmsKey = new Key(this, "SecretsManagerCMK", {
      alias: tagconfig.appid + "/" + tagconfig.appfunc + "/" + tagconfig.appenv + "/" + tagconfig.name + "/" 
              + "kmsKey", 
      description: "KMS key to manage" + tagconfig.appid + "keys in Secrets Manager",
      enableKeyRotation: true
    });

    const SecretsManagerPolicy = new iam.PolicyStatement();
    SecretsManagerPolicy.addAnyPrincipal();
    SecretsManagerPolicy.addActions(
        'kms:Encrypt',
        'kms:Decrypt',
        'kms:ReEncrypt*',  
        'kms:CreateGrant',
        'kms:DescribeKey',
        'kms:GenerateDataKey'
    );
    SecretsManagerPolicy.addResources('*');
    SecretsManagerPolicy.addCondition("StringEquals", {"kms:CallerAccount" : this.account});
    SecretsManagerPolicy.addCondition("StringEquals", {
      "kms:ViaService" : "secretsmanager." + this.region + ".amazonaws.com"});

    kmsKey.addToResourcePolicy(SecretsManagerPolicy);
    
    // -- 2. Create a empty shell (no value or dummy) secret -- //

    const Secret = new secretsmanager.Secret(this, 'App1Secret', {
      secretName: "/" + tagconfig.appid + "/" + tagconfig.appfunc + "/" + tagconfig.appenv + "/" + tagconfig.name,
      encryptionKey: kmsKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ database: 'fill_name_of_the_database', username: 'fill_username' }),
        generateStringKey: 'password',
        excludeCharacters: '\"@/\\',
      },
    });

    // add tags to secrets
    Tags.of(Secret).add('name', tagconfig.name);
    Tags.of(Secret).add('appid', tagconfig.appid);
    Tags.of(Secret).add('appfunc', tagconfig.appfunc);
    Tags.of(Secret).add('appenv', tagconfig.appenv);
    Tags.of(Secret).add('dataclassification', tagconfig.dataclassification);

    // --3. Create an IAM managed policy powered by ABAC to allow Secret access -- //

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
            'secretsmanager:DescribeSecret'
          ],
          resources: [Secret.secretArn],
          conditions: conditionToMatchResourceTagWithPrincipalTag
        })
      ],
    });
    
    // --4. Create network supporting 3-tier application with endpoint interfaces -- //

    const network = new newVpcAndEndpoints(this,'newVpcAndEndpoints', {});
    
    // --4. Create a SSM parameter with ASM arn -- //

    const asmSsmParam = new ssm.StringParameter(this, 'ASM StringParameter', {
      description: 'SSM Parameter to store Secrets ARN for' + tagconfig.appid,
      parameterName: "/" + tagconfig.appid + "/" + tagconfig.appfunc + "/" + tagconfig.appenv + "/" 
                      + tagconfig.name + "-AsmSsmPara",
      simpleName: false,
      stringValue: Secret.secretArn,
    });

    const iamPolSsmParam = new ssm.StringParameter(this, 'IAM Policy StringParameter', {
      description: 'SSM Parameter to store IAM Policy ARN for' + tagconfig.appid,
      parameterName: "/" + tagconfig.appid + "/" + tagconfig.appfunc + "/" + tagconfig.appenv + "/" 
                    + tagconfig.name + "-IAMSsmPara",
      simpleName: false,
      stringValue: managedPolicy.managedPolicyArn,
    });

    // Common cdk-nag suppressions
    
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-SMG4',
        reason: 'Sample implementation of empty Secrets creation, rotation strategy is not known for the use case and and rotation would be enabled via another stack'
      }
    ]);
  }
}
