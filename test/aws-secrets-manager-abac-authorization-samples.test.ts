// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { commonSecretsAndIamPolicyStack } from '../lib/commonSecretsAndIamPolicy-stack';
import { RolesanywhereabacStack } from '../lib/forOnPremAppRolesAnyWhereAbac-stack'

test('Test Common Stack', () => {
  const app = new cdk.App();
     // WHEN
  const stack = new commonSecretsAndIamPolicyStack(app, 'commonSecretsAndIamPolicyStack');
    // THEN
  const template = Template.fromStack(stack);
    // Assert the template matches the snapshot.
  expect(template.toJSON()).toMatchSnapshot();
});

test('Test onPrem IAM ROle Anywhere Stack', () => {
    const app = new cdk.App();
       // WHEN
    const stack = new RolesanywhereabacStack(app, 'RolesanywhereabacStack');
      // THEN
    const template = Template.fromStack(stack);
      // Assert the template matches the snapshot.
    expect(template.toJSON()).toMatchSnapshot();
});
