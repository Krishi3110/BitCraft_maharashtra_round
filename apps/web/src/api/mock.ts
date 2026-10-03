export function getMockApi() {
  return {
    getEventDetails: async () => ({ id: 'ev_123', name: 'FUTUREFEST 2026', totalTickets: 500 }),
    joinDrop: async () => ({ status: 'waiting', participantId: 'p_999' }),
    getAllocationStatus: async () => ({ status: 'allocated' }),
  };
}
