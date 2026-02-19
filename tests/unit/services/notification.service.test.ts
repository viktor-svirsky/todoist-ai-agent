import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { NotificationService } from '../../../src/services/notification.service';

vi.mock('axios');

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    service = new NotificationService('https://test.example.com');
    vi.clearAllMocks();
  });

  it('should send success notification', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: {} });

    await service.sendNotification({
      taskTitle: 'Test task',
      status: 'success',
      timestamp: '2026-02-19T10:00:00Z'
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://test.example.com',
      expect.objectContaining({
        taskTitle: 'Test task',
        status: 'success'
      }),
      expect.objectContaining({
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      })
    );
  });

  it('should send error notification with message', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: {} });

    await service.sendNotification({
      taskTitle: 'Test task',
      status: 'error',
      message: 'Something failed',
      timestamp: '2026-02-19T10:00:00Z'
    });

    expect(axios.post).toHaveBeenCalledWith(
      'https://test.example.com',
      expect.objectContaining({
        taskTitle: 'Test task',
        status: 'error',
        message: 'Something failed'
      }),
      expect.objectContaining({
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      })
    );
  });

  it('should fail gracefully on network error', async () => {
    vi.mocked(axios.post).mockRejectedValueOnce(new Error('Network error'));

    await expect(
      service.sendNotification({
        taskTitle: 'Test',
        status: 'success',
        timestamp: '2026-02-19T10:00:00Z'
      })
    ).resolves.not.toThrow();
  });
});
