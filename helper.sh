#!/usr/bin/env bash

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

pre-req() {
    echo ""
    while true; do
        read -p "--> Have you updated 'tag' parameters file at 'configs/tagconfig.json' (y/n) ?:" yn
        case $yn in
        [Yy]*) break;;
        [Nn]*) exit ;;
        *) echo "Please answer yes(y) or no(n)." ;;
        esac
    done
}

cdk_deploy_common(){
    echo "--> Preparing"
    echo ""
    npm install

    echo "--> jest Testing"
    echo ""
    npm test
    
    echo "--> Building"
    echo ""
    npm ci

    echo "--> Prerequisites install complete"
    echo ""
    echo "--> Deploying common stack...  "
    echo ""
    echo "--> It deploys a empty shell secret and IAM managed policy. "
    echo ""
    npx cdk deploy commonSecretsAndIamPolicyStack --require-approval=never
}

cdk_deploy_on_cloud_sampleapp(){
    echo "--> Preparing"
    echo ""
    npm install

    echo "--> Building"
    echo ""
    npm ci

    echo "--> Prerequisites install complete"
    echo ""
    echo "--> Deploying sample application stack... "
    echo ""
    echo "--> Deploying an IAM role used by a lambda to fetch the secrets created in common stack. "
    echo "--> Deploying Serverless DB test sample lambda connection. "
    echo ""
    npx cdk deploy SampleAppOnAWSStack --require-approval=never
}

cdk_deploy_on_prem_rolesanywhere(){
    echo "--> Preparing"
    echo ""
    npm install

    echo "--> Building"
    echo ""
    npm ci

    echo "--> Prerequisites install complete"
    echo ""
    echo "--> Deploying stacks to support roles anywhere for on-prem secrets fetech... "
    echo ""
    echo "--> It deploys an IAM role anywhere used by on-prem app to fetch the secrets created in common stack. "
    echo ""
    echo "--> Additionally, this stacks deploys a Private CA to support IAM role anywhere function . "
    echo ""
    npx cdk deploy RolesanywhereabacStack --require-approval=never
}


check_aws_signing_helper() {
    echo ""
    cd ~/.aws
    echo "--> Check if aws_signing_helper already exist at AWS CLI folder. "
    if [ -f ./aws_signing_helper ]
        then 
        echo "~/.aws/aws_signing_helper exists."
        return 0
    else
        echo "--> Download aws_signing_helper. "
        while true; do
            read -p "--> Press "1" for mac and "2" for linux ?:" answer
            case $answer in
            "1") 
            wget https://s3.amazonaws.com/roles-anywhere-credential-helper/CredentialHelper/latest/darwin_amd64/aws_signing_helper
            chmod +x aws_signing_helper
            return 0
            ;;
            "2") 
            wget https://s3.amazonaws.com/roles-anywhere-credential-helper/CredentialHelper/latest/linux_amd64/aws_signing_helper
            chmod +x aws_signing_helper
            return 0
            ;;
            *) echo "Please answer 1 for mac or 2 for linux." ;;
            esac
        done
    fi
}

update_aws_cli_config () {
    
cat >> config <<EOF

[profile developer]
region = $AWS_REGION
credential_process = $HOME/.aws/aws_signing_helper credential-process
    --certificate $HOME/.aws/client_cert.pem
    --private-key $HOME/.aws/my_private_key.clear.key
    --trust-anchor-arn $ROLE_ANYWHERE_TRUST_ANCHOR_ARN 
    --profile-arn $ROLE_ANYWHERE_PROFILE 
    --role-arn $IAM_ROLE_ARN
    
EOF
cat config
}   

does_assume_role_work () {
    PROFILE_NAME="developer"
    aws_cli="aws --region $AWS_REGION --profile $PROFILE_NAME"

    echo "--> Checking credentials ..."
    if ! $aws_cli sts get-caller-identity; then
        echo "--> Credentials fetch didnt work. "
    else 
        ROLEANYWHERE=$($aws_cli sts get-caller-identity --query Arn --output text)
        echo "--> Assume role worked for:"
        echo $ROLEANYWHERE
        echo ""
        echo "--> This role can be used by the application using AWS CLI profile '$PROFILE_NAME'. "
        echo ""
        echo "--> For instance, the following output illustrates how to access secret values using an AWS CLI profile '$PROFILE_NAME'. "
        SECRET_VALUE=$($aws_cli secretsmanager get-secret-value --secret-id $SECRET_ARN  | jq -r '.SecretString')
        echo ""
        echo "--> Sample AWS CLI: aws secretsmanager get-secret-value --secret-id \$SECRET_ARN --profile developer"
    fi
}

client_prepare_for_roles_anywhere(){

    echo "--> Check if AWS CLI is installed"
    if ! [ -x "$(command -v aws)" ]; then
        echo 'Error: aws cli is not installed.' >&2
        exit 1
    elif ! [ -x "$(command -v jq)" ]; then
        echo 'Error: jq is not installed.' >&2
        exit 1
    else
        echo "--> AWS CLI Found "
        echo ""
        echo "--> Getting current AWS region "
        echo ""
        AWS_REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
        echo $AWS_REGION
        echo "--> Using Tags to create SSM ARNs "
        echo ""
        cd configs
        SSM_PARA_PREFIX=$(jq -r '"/" + .appid + "/" + .appfunc + "/" + .appenv + "/" + .name' tagconfig.json)
        echo "SSM_PARA_PREFIX: $SSM_PARA_PREFIX"
        IAM_ROLE_ARN=$(aws ssm get-parameter --name $SSM_PARA_PREFIX-onPremAppRoleSsmParam --query Parameter.Value --output text)
        echo "IAM_ROLE_ARN: $IAM_ROLE_ARN"
        PCA_ARN=$(aws ssm get-parameter --name $SSM_PARA_PREFIX-pcaArnSsmParam --query Parameter.Value --output text)
        echo "PCA_ARN: $PCA_ARN"
        ROLE_ANYWHERE_TRUST_ANCHOR_ARN=$(aws ssm get-parameter --name $SSM_PARA_PREFIX-rolesAnywhereTrustAnchorSsmParam --query Parameter.Value --output text)
        echo "ROLE_ANYWHERE_TRUST_ANCHOR_ARN: $ROLE_ANYWHERE_TRUST_ANCHOR_ARN"
        ROLE_ANYWHERE_PROFILE=$(aws ssm get-parameter --name $SSM_PARA_PREFIX-rolesAnywhereProfileSsmParam --query Parameter.Value --output text )
        echo "ROLE_ANYWHERE_PROFILE: $ROLE_ANYWHERE_PROFILE"
        SECRET_ARN=$(aws ssm get-parameter --name $SSM_PARA_PREFIX-AsmSsmPara --query Parameter.Value --output text)
        echo "SECRET_ARN: $SECRET_ARN"
        echo ""
        echo "--> Downloading aws_signing_helper"
        cd ..
        pwd
        check_aws_signing_helper
        echo ""
        echo "--> Changing Directory AWS CLI Folder"
        cd ~/.aws
        pwd
        echo ""
        echo "--> Requesting an ACM Certificate"
        echo ""
        echo "--> Using OpenSSL to generate a RSA keypair and signing a certificate signing request."
        echo ""
        echo "--> Follow the prompt"
        echo ""
        openssl req -new -newkey rsa:2048 -days 300 -keyout my_private_key.key -out my_csr.out
        echo ""       
        echo "--> Decrypting the Private key as aws_signing_helper cant read encrypted RSA keys. "
        echo ""  
        openssl rsa -in my_private_key.key -out my_private_key.clear.key
        echo ""       
        echo "--> Using PCAs IssueCertificate API to request certificate from Root PCA created. "
        echo ""
        CLIENT_CERT_ARN=$(aws acm-pca issue-certificate \
                        --certificate-authority-arn $PCA_ARN \
                        --csr fileb://my_csr.out \
                        --signing-algorithm "SHA256WITHRSA" \
                        --validity Value=300,Type="DAYS" | jq -r .CertificateArn)
        echo ""
        echo $CLIENT_CERT_ARN
        echo "--> Using PCAs GetCertificate API to request certificate from Root PCA created. "
        if [ -z $CLIENT_CERT_ARN ]; then 
            echo ""
            echo "--> Certificate ARN Not Found."
            break
        else
            sleep 2
            echo ""
            echo "--> Certificate ARN Found."
            echo ""
            echo "--> Saving client certificate body into a file "
            aws acm-pca get-certificate \
            --certificate-authority-arn $PCA_ARN \
            --certificate-arn $CLIENT_CERT_ARN | jq -r .Certificate > client_cert.pem
        fi

        echo ""
        echo "--> Update the 'config' file with credential_process. "
        echo ""
        update_aws_cli_config
        echo ""
        does_assume_role_work

    fi
}

update_secrets_value() {
  SSM_PARA_PREFIX=$(jq -r '"/" + .appid + "/" + .appfunc + "/" + .appenv + "/" + .name' ./configs/tagconfig.json)
  local SECRET_ID=$(aws ssm get-parameter --name $SSM_PARA_PREFIX-AsmSsmPara --query Parameter.Value --output text)

  echo "Checking secret"
  if ! aws secretsmanager describe-secret --secret-id "$SECRET_ID"  > /dev/null 2>&1 ; then
    echo "Couldn't find the secret '$SECRET_ID'"
    return
  fi

  echo "Checking Secretstring"

  Secret=$(aws secretsmanager get-secret-value --secret-id $SECRET_ID )
  SecretString=$(jq -r '.SecretString' <<< $Secret)

  if [ -z "${SecretString##*fill_username*}" ]; then
      echo "Secret currently has dummy value, need to update Secret value"
      read -p "Enter Servertype: " servertype
      read -p "Enter Username: " username
      read -p "Enter Password: " -s password
      local SECRET_JSON=$(jq -n \
        --arg servertype "$servertype" \
        --arg username "$username" \
        --arg password "$password" \
        '{"servertype": $servertype, "username": $username, "password": $password}')

      echo "Updating secret"
      if ! aws secretsmanager put-secret-value --secret-id "$SECRET_ID" --secret-string "$SECRET_JSON"; then
        echo "Failed to update the secret"
      else
        echo "Successfully updated the secret"
      fi
  else
      echo "Secret with ARN: $SECRET_ID does not contain a dummy value."
  fi;
}

on-aws-test-simple() {
    echo "--> Check if AWS CLI is installed"
    if ! [ -x "$(command -v aws)" ]; then
        echo 'Error: aws cli is not installed.' >&2
        exit 1
    elif ! [ -x "$(command -v jq)" ]; then
        echo 'Error: jq is not installed.' >&2
        exit 1
    else
        echo ""
        echo "--> AWS CLI Found "
        echo ""
        echo "--> Using Tags to create Lambda function name and invoking a test "
        echo ""
        cd configs
        TEST_LAMBDA_FUNCTION_NAME=$(jq -r '"asmFetchLambda" + "_" + .appid + "_" + .appfunc + "_" + .appenv' tagconfig.json)
        TEST_LAMBDA_FUNCTION_OUTPUT=$(aws lambda invoke --function-name $TEST_LAMBDA_FUNCTION_NAME --payload '{"key1":"value1"}' response.txt)
        echo ""
        echo "--> Checking the lambda invoke response..... "
        echo ""
        if [ "$(echo $TEST_LAMBDA_FUNCTION_OUTPUT | jq -r .StatusCode)" -eq 200 ]; then
            echo "--> The status code is 200"
            echo ""
            echo "--> Reading response from test function: "
            cat response.txt
            echo ""
            echo ""
            echo "--> Response shows database connection is working from lambda function using secret. "
        else
            echo "--> The status code is not 200"
        fi
        rm -rf response.txt
        cd ..
    fi
}

on-prem-test-simple () {
    PROFILE_NAME="developer"
    AWS_REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
    aws_cli="aws --region $AWS_REGION --profile $PROFILE_NAME"
    cd configs
    SSM_PARA_PREFIX=$(jq -r '"/" + .appid + "/" + .appfunc + "/" + .appenv + "/" + .name' tagconfig.json)
    SECRET_ARN=$(aws ssm get-parameter --name $SSM_PARA_PREFIX-AsmSsmPara --query Parameter.Value --output text)
    cd ..

    echo "--> Checking credentials ..."
    if ! $aws_cli sts get-caller-identity; then
        echo "--> Credentials fetch didnt work. "
    else 
        ROLEANYWHERE=$($aws_cli sts get-caller-identity --query Arn --output text)
        echo "--> Assume role worked for:"
        echo $ROLEANYWHERE
        echo ""
        echo "--> This role can be used by the application using AWS CLI profile '$PROFILE_NAME'. "
        echo ""
        echo "--> For instance, the following output illustrates how to access secret values using an AWS CLI profile '$PROFILE_NAME'. "
        SECRET_VALUE=$($aws_cli secretsmanager get-secret-value --secret-id $SECRET_ARN  | jq -r '.SecretString')
        echo ""
        echo "--> Sample AWS CLI: aws secretsmanager get-secret-value --secret-id \$SECRET_ARN --profile \$PROFILE_NAME"
        echo "-------Output-------"
        echo $SECRET_VALUE | jq .
        echo "-------Output-------"
    fi
}

case $1 in
"prepare")
  pre-req
  cdk_deploy_common
  ;;
"on-aws")
  update_secrets_value
  cdk_deploy_on_cloud_sampleapp
  ;;
"on-prem")
  cdk_deploy_on_prem_rolesanywhere
  ;;
"update-secret")
  update_secrets_value
  ;;
"client-profile-setup")
  client_prepare_for_roles_anywhere
  ;;
"install-all")
  pre-req
  cdk_deploy_common
  update_secrets_value
  cdk_deploy_on_cloud_sampleapp
  cdk_deploy_on_prem_rolesanywhere
  client_prepare_for_roles_anywhere
  ;;
"on-aws-test")
  on-aws-test-simple
  ;;
"on-prem-test")
  on-prem-test-simple
  ;;    
*) 
  echo "#######################################################################################################"
  echo "$Usage: "
  echo ""
  echo "STEP 1 (Deploy the common Stack )"
  echo "-------"
  echo "# ./helper.sh prepare"
  echo ""
  echo "STEP 2a (Run this command after prepare is run. This command creates a sample app and IAM role powered by ABAC)"
  echo "-------"
  echo "# ./helper.sh on-aws"
  echo ""
  echo "STEP 2b (Run this command after prepare is run. This command creates a resources to use IAM role anywhere powered by ABAC)"
  echo "-------"
  echo "# ./helper.sh on-prem"
  echo ""
  echo "OPTIONAL COMMANDS"
  echo "-------------------------------------------------------------------------------------------"
  echo "# ./helper.sh update-secret (Updates the secrets value from dummy to real one). "
  echo ""
  echo "# ./helper.sh client-profile-setup (Updates the client AWS CLI to use IAM Role Anywhere). "
  echo ""
  echo "# ./helper.sh install-all (Deploy all CDK stacks). "
  echo ""
  echo "# ./helper.sh on-aws-test (Test sample app on Lambda access to Secret). "
  echo ""
  echo "# ./helper.sh on-prem-test (Test IAM RoleAnyWhere profile access to Secret). "
  echo ""
  echo "#######################################################################################################"
  ;;
esac