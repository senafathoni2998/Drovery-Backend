import { Test, TestingModule } from '@nestjs/testing';

import { SavedAddressesController } from './saved-addresses.controller';
import { SavedAddressesService } from './saved-addresses.service';

describe('SavedAddressesController', () => {
  let controller: SavedAddressesController;
  let service: {
    findAll: jest.Mock;
    getRecent: jest.Mock;
    create: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    setDefault: jest.Mock;
    remove: jest.Mock;
  };
  const userId = 'u1';

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue([]),
      getRecent: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'a1' }),
      findOne: jest.fn().mockResolvedValue({ id: 'a1' }),
      update: jest.fn().mockResolvedValue({ id: 'a1' }),
      setDefault: jest.fn().mockResolvedValue({ id: 'a1', isDefault: true }),
      remove: jest.fn().mockResolvedValue({ success: true }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SavedAddressesController],
      providers: [{ provide: SavedAddressesService, useValue: service }],
    }).compile();
    controller = module.get(SavedAddressesController);
  });

  it('delegates each route to the service', async () => {
    await controller.findAll(userId);
    expect(service.findAll).toHaveBeenCalledWith(userId);

    await controller.getRecent(userId);
    expect(service.getRecent).toHaveBeenCalledWith(userId);

    await controller.create(userId, { label: 'Home', address: 'X' });
    expect(service.create).toHaveBeenCalledWith(userId, {
      label: 'Home',
      address: 'X',
    });

    await controller.findOne(userId, 'a1');
    expect(service.findOne).toHaveBeenCalledWith(userId, 'a1');

    await controller.update(userId, 'a1', { label: 'New' });
    expect(service.update).toHaveBeenCalledWith(userId, 'a1', { label: 'New' });

    await controller.setDefault(userId, 'a1');
    expect(service.setDefault).toHaveBeenCalledWith(userId, 'a1');

    const res = await controller.remove(userId, 'a1');
    expect(service.remove).toHaveBeenCalledWith(userId, 'a1');
    expect(res).toEqual({ success: true });
  });
});
