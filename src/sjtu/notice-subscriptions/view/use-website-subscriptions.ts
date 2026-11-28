import { useQuery } from '@tanstack/react-query';
import { createClient } from '../../../core/protocol/contract';
import { websiteSubscriptionsContract } from '../contract';

export const websiteSubscriptionsClient = createClient(
  websiteSubscriptionsContract,
  window.dela?.bridge,
);

export function useWebsiteSubscriptions() {
  return useQuery({
    queryKey: ['notifications', 'state', 'websiteSubscriptions'],
    queryFn: () => websiteSubscriptionsClient.subscriptions(),
    enabled: Boolean(window.dela?.bridge),
  });
}
