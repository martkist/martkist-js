import axios from 'axios';
import { martkistRpcAddressIndexServices } from './services/martkist-rpc-address-index-services';
import { martkistRpcBlockchainServices } from './services/martkist-rpc-blockchain-services';
import { martkistRpcDiagnosticServices } from './services/martkist-rpc-diagnostic-services';
import { martkistRpcEstimateServices } from './services/martkist-rpc-estimate-services';
import { martkistRpcGenerationServices } from './services/martkist-rpc-generation-services';
import { martkistRpcGovernanceServices } from './services/martkist-rpc-governance-services';
import { martkistRpcMasternodeServices } from './services/martkist-rpc-masternode-services';
import { martkistRpcMessagingServices } from './services/martkist-rpc-messaging-services';
import { martkistRpcMiningServices } from './services/martkist-rpc-mining-services';
import { martkistRpcNetworkServices } from './services/martkist-rpc-network-services';
import { martkistRpcSynchronizationServices } from './services/martkist-rpc-synchronization-services';
import { martkistRpcTransactionServices } from './services/martkist-rpc-transaction-services';
import { martkistRpcUtilityServices } from './services/martkist-rpc-utility-services';
import { martkistRpcWalletServices } from './services/martkist-rpc-wallet-services';
import { martkistRpcMixingServices } from './services/martkist-rpc-mixing-services';
import LoggerFactory  from './loggers/logger-factory';
import LOG_LEVELS from "./loggers/log-levels";
import ConnectionRefusedErrorHandler from './error-handlers/connection-refused-error-handler';
import AuthorizationFailedErrorHandler from './error-handlers/authorization-failed-error-handler';
import RpcMethodNotFoundErrorHandler from './error-handlers/rpc-method-not-found-error';
import RpcException from './rpc-exception';
import RpcErrorHandler from './error-handlers/rpc-error-handler';
import NonSpecificNetworkErrorHandler from './error-handlers/non-specific-network-error-handler';
import { callRpcWithCoercedStringArguments } from './call-rpc-with-coerced-arguments';

export default class MartkistRpcClient {


    constructor({baseUrl="localhost",
                port=8368,
                username='',
                password='',
                useSsl=false,
                timeout=30000,
                customHttpAgent,
                loggerLevel=LOG_LEVELS.silent, 
                whitelist=[], 
                blacklist=[]} = {}) {

        let configOptions = { baseUrl, port, username, password, useSsl, timeout, customHttpAgent, loggerLevel }

        let logger = LoggerFactory.createLogger(configOptions.loggerLevel, whitelist, blacklist);

        let instance = axios.create(createConfigurationObject(
            configOptions.username,
            configOptions.password,
            configOptions.useSsl,
            configOptions.timeout,
            configOptions.customHttpAgent));
            
        let url = `${configOptions.useSsl ? "https" : "http"}://${configOptions.baseUrl}:${configOptions.port}`;


        let callRpc = async (methodName, args=[]) => {
            let data = {
                jsonrpc: "1.0",
                method: methodName.toLowerCase(),  // safety check: the RPC expects methods in all lowercase,
                                                   // so we'll take that knowledge burden here instead of making
                                                   // the consuming methods worry about it
                params: Array.from(args).filter(element => element !== undefined)
            };
            logger.logRpcCall(data);

            try {
                return await getResponseFromRpcCall(url, data, logger);
            }
            catch (rpcError) {
                return getErrorInformationFromRpcCall({rpcError: rpcError, 
                        methodName: data.method, 
                        logger: logger,
                        url: url});                
            }
        }

        this.callRpc = callRpcWithCoercedStringArguments(callRpc);
        this.addressIndexServices = martkistRpcAddressIndexServices(callRpc);
        this.blockchainServices = martkistRpcBlockchainServices(callRpc);
        this.diagnosticServices = martkistRpcDiagnosticServices(callRpc);
        this.estimateServices = martkistRpcEstimateServices(callRpc);
        this.generationServices = martkistRpcGenerationServices(callRpc);
        this.governanceServices = martkistRpcGovernanceServices(callRpc);
        this.masternodeServices = martkistRpcMasternodeServices(callRpc);
        this.messagingServices = martkistRpcMessagingServices(callRpc);
        this.miningServices = martkistRpcMiningServices(callRpc);
        this.mixingServices = martkistRpcMixingServices(callRpc);
        this.networkServices = martkistRpcNetworkServices(callRpc);
        this.synchronizationServices = martkistRpcSynchronizationServices(callRpc);
        this.transactionServices = martkistRpcTransactionServices(callRpc);
        this.utilityServices = martkistRpcUtilityServices(callRpc);
        this.walletServices = martkistRpcWalletServices(callRpc, this.utilityServices);

        let createCustomErrorResponse = (errorMessage, code=-1000) => {
            let errorResponse = {
                result: null,
                error: errorMessage,
                code: code
            };
            return new RpcException(errorResponse);
        }

        async function getResponseFromRpcCall(url, data, logger) {
            let responseFromRpc = await instance.post(url, data);
            let dataFromRpc = responseFromRpc.data;

            if (dataFromRpc) {
                logger.logDataFromRpc(data.method, dataFromRpc); 
                return dataFromRpc.result ? dataFromRpc.result : dataFromRpc
            }
            else {
                logger.logAlternateResponseFromRpc(data.method, responseFromRpc);
                return responseFromRpc;
            }
        }


        function getErrorInformationFromRpcCall({rpcError, methodName, url, logger}) {
            
            let commonErrorHandlers = [
                new ConnectionRefusedErrorHandler(url, logger, createCustomErrorResponse),
                new AuthorizationFailedErrorHandler(url, logger, createCustomErrorResponse),
                new RpcMethodNotFoundErrorHandler(methodName, logger, createCustomErrorResponse),
                new RpcErrorHandler(methodName, logger), 
                new NonSpecificNetworkErrorHandler(url, logger, createCustomErrorResponse)
            ]

            for (let i = 0; i < commonErrorHandlers.length; ++i) {
                if (commonErrorHandlers[i].matchesType(rpcError)) {
                    throw commonErrorHandlers[i].logAndReturn(rpcError);
                }
            }

            // If it's none of these, we've encountered something totally unknown.
            throw new RpcException({
                result: rpcError,
                error: 'An unrecognized error occurred',
                code: -2000
            });


        }

        function createConfigurationObject(username, password, useSsl,timeout, customHttpAgent) {
            let configurationObject = {
                auth: {
                    username: username,
                    password: password    
                },
                timeout: timeout
            }
            
            if (customHttpAgent) {
                let agentProperty = useSsl ? "httpsAgent" : "httpAgent";
                configurationObject[agentProperty] = customHttpAgent;
            } 
            
            return configurationObject;
        }

        // General commands that don't seem to fit in a logical grouping
        this.sentinelPing = async(versionString) => {
            return await callRpc('sentinelping',[versionString]);
        }

        
    }
}
