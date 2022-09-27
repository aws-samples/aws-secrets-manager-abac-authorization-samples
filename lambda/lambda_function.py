# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import boto3
import json
import logging
import os
import pymysql

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    arn = os.environ['ASM_ARN']
    # Setup the client
    service_client = boto3.client('secretsmanager', endpoint_url=os.environ['SECRETS_MANAGER_ENDPOINT'])

    # Make sure the version is staged correctly
    metadata = service_client.describe_secret(SecretId=arn)

    current_dict = get_secret_dict(service_client, arn)
    test_connection = get_connection(current_dict)
    return test_connection



def get_secret_dict(service_client, arn):
    required_fields = ['host', 'username', 'password']
    secret = service_client.get_secret_value(SecretId=arn)
    plaintext = secret['SecretString']
    secret_dict = json.loads(plaintext)

    # Run validations against the secret
    if 'engine' not in secret_dict or secret_dict['engine'] != 'mysql':
        raise KeyError("Database engine must be set to 'mysql' in order to use this rotation lambda")
    for field in required_fields:
        if field not in secret_dict:
            raise KeyError("%s key is missing from secret JSON" % field)

    # Parse and return the secret JSON string
    return secret_dict



def get_connection(secret_dict):
    # Parse and validate the secret JSON string
    port = int(secret_dict['port']) if 'port' in secret_dict else 3306
    dbname = secret_dict['dbname'] if 'dbname' in secret_dict else None

    # Get SSL connectivity configuration
    use_ssl, fall_back = get_ssl_config(secret_dict)

    # if an 'ssl' key is not found or does not contain a valid value, attempt an SSL connection and fall back to non-SSL on failure
    conn = connect_and_authenticate(secret_dict, port, dbname, use_ssl)
    try:
        c = conn.cursor()
    except OperationalError:
        return 'Connection to the DB is not working.'
    else:
        return 'Connection to the DB is working.'

def connect_and_authenticate(secret_dict, port, dbname, use_ssl):
    ssl = {'ca': '/etc/pki/tls/cert.pem', } if use_ssl else None

    # Try to obtain a connection to the db
    try:
        # Checks hostname and verifies server certificate implictly when 'ca' key is in 'ssl' dictionary
        conn = pymysql.connect(host=secret_dict['host'], user=secret_dict['username'], password=secret_dict['password'], port=port, database=dbname, connect_timeout=5, ssl=ssl)
        logger.info("Successfully established %s connection as user '%s' with host: '%s'" % ("SSL/TLS" if use_ssl else "non SSL/TLS", secret_dict['username'], secret_dict['host']))
        return conn
    except pymysql.OperationalError as e:
        if 'certificate verify failed: IP address mismatch' in e.args[1]:
            logger.error("Hostname verification failed when estlablishing SSL/TLS Handshake with host: %s" % secret_dict['host'])
        return None

def get_ssl_config(secret_dict):
    # Default to True for SSL and fall_back mode if 'ssl' key DNE
    if 'ssl' not in secret_dict:
        return True, True

    # Handle type bool
    if isinstance(secret_dict['ssl'], bool):
        return secret_dict['ssl'], False

    # Handle type string
    if isinstance(secret_dict['ssl'], str):
        ssl = secret_dict['ssl'].lower()
        if ssl == "true":
            return True, False
        elif ssl == "false":
            return False, False
        else:
            # Invalid string value, default to True for both SSL and fall_back mode
            return True, True

    # Invalid type, default to True for both SSL and fall_back mode
    return True, True