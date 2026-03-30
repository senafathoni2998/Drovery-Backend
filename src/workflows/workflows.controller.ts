import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { CompleteStepDto } from './dto';
import { WorkflowsService } from './workflows.service';

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Get()
  getAll() {
    return this.workflowsService.getAll();
  }

  @Get(':id')
  getWorkflow(@Param('id') id: string) {
    return this.workflowsService.getWorkflow(id);
  }

  @Post(':deliveryId/steps/complete')
  completeStep(
    @Param('deliveryId') deliveryId: string,
    @Body() dto: CompleteStepDto,
  ) {
    return this.workflowsService.completeStep(deliveryId, dto);
  }

  @Get(':deliveryId/steps/:workflowId')
  getCompletedSteps(
    @Param('deliveryId') deliveryId: string,
    @Param('workflowId') workflowId: string,
  ) {
    return this.workflowsService.getCompletedSteps(deliveryId, workflowId);
  }

  @Post('qr/generate')
  generateQrPayload(@Body('deliveryId') deliveryId: string) {
    return { payload: this.workflowsService.generateQrPayload(deliveryId) };
  }

  @Post('qr/validate')
  validateQrPayload(@Body('payload') payload: string) {
    return this.workflowsService.validateQrPayload(payload);
  }
}
