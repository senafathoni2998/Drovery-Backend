import { Test, TestingModule } from '@nestjs/testing';

import { ProofController } from './proof.controller';
import { ProofService } from './proof.service';

describe('ProofController', () => {
  let controller: ProofController;
  let proofService: { submitProof: jest.Mock; getProof: jest.Mock };

  beforeEach(async () => {
    proofService = {
      submitProof: jest.fn().mockResolvedValue({ id: 'pod-1' }),
      getProof: jest.fn().mockResolvedValue({ id: 'pod-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProofController],
      providers: [{ provide: ProofService, useValue: proofService }],
    }).compile();

    controller = module.get<ProofController>(ProofController);
  });

  it('submit delegates to proofService.submitProof', async () => {
    const dto = { photoBase64: 'abc' };

    const result = await controller.submit('user-1', 'd-1', dto);

    expect(proofService.submitProof).toHaveBeenCalledWith('user-1', 'd-1', dto);
    expect(result).toEqual({ id: 'pod-1' });
  });

  it('get delegates to proofService.getProof', async () => {
    const result = await controller.get('user-1', 'd-1');

    expect(proofService.getProof).toHaveBeenCalledWith('user-1', 'd-1');
    expect(result).toEqual({ id: 'pod-1' });
  });
});
