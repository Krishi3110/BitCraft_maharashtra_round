import { ApiClient } from './types';
import { MockApiClient } from './mock';
import { RealApiClient } from './real';

const useMock = import.meta.env.VITE_API_MODE === 'mock';

export const apiClient: ApiClient = useMock ? new MockApiClient() : new RealApiClient();
