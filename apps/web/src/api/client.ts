import { getMockApi } from './mock';

const USE_MOCK = true;

export const apiClient = USE_MOCK ? getMockApi() : {};
