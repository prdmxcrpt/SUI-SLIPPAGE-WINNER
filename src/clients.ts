import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuiGraphQLClient } from '@mysten/sui/graphql';

export interface SuiClients {
  grpc: SuiGrpcClient;
  graphql: SuiGraphQLClient;
}

export function createSuiClients(
  grpcEndpoint = 'https://fullnode.mainnet.sui.io:443',
  graphqlEndpoint = 'https://sui-mainnet.mystenlabs.com/graphql'
): SuiClients {
  const grpc = new SuiGrpcClient({
    network: 'mainnet',
    baseUrl: grpcEndpoint,
  });

  const graphql = new SuiGraphQLClient({
    network: 'mainnet',
    url: graphqlEndpoint,
  });

  return { grpc, graphql };
}
