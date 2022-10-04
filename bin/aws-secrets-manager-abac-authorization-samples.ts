#!/usr/bin/env node

// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { commonSecretsAndIamPolicyStack } from '../lib/commonSecretsAndIamPolicy-stack';
import { RolesanywhereabacStack } from '../lib/forOnPremAppRolesAnyWhereAbac-stack'
import { SampleAppOnAWSStack } from '../lib/forSampleAppOnAws-stack'
import { AwsSolutionsChecks } from "cdk-nag";

const app = new cdk.App();

// Common CDK Stack - to create secrets and ABAC managed policy

new commonSecretsAndIamPolicyStack(app, 'commonSecretsAndIamPolicyStack', {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION,
      },    
});

// IAM Roles AnyWhere CDK Stack 
new RolesanywhereabacStack(app, 'RolesanywhereabacStack', {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION,
      },
    
});

// This stack is dependent on SecretCreationCdkStack and it creates a sample lambda to fetch secrets with IAM roles 
// allowed 

new SampleAppOnAWSStack(app, 'SampleAppOnAWSStack', {
    env: {
        account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION,
      },
    
});
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));