import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

import { WorkflowStepDto } from '../deliveries/dto/delivery-response.dto';
import { CompleteStepDto } from './dto';
import {
  QrGenerateResponseDto,
  QrValidateResponseDto,
  WorkflowResponseDto,
} from './dto/workflow-response.dto';
import { WorkflowsService } from './workflows.service';

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Get()
  @ApiOkResponse({ type: [WorkflowResponseDto] })
  getAll() {
    return this.workflowsService.getAll();
  }

  @Get(':id')
  @ApiOkResponse({ type: WorkflowResponseDto })
  getWorkflow(@Param('id') id: string) {
    return this.workflowsService.getWorkflow(id);
  }

  @Post(':deliveryId/steps/complete')
  @ApiCreatedResponse({ type: WorkflowStepDto })
  completeStep(
    @Param('deliveryId') deliveryId: string,
    @Body() dto: CompleteStepDto,
  ) {
    return this.workflowsService.completeStep(deliveryId, dto);
  }

  @Get(':deliveryId/steps/:workflowId')
  @ApiOkResponse({ type: [WorkflowStepDto] })
  getCompletedSteps(
    @Param('deliveryId') deliveryId: string,
    @Param('workflowId') workflowId: string,
  ) {
    return this.workflowsService.getCompletedSteps(deliveryId, workflowId);
  }

  @Post('qr/generate')
  @ApiCreatedResponse({ type: QrGenerateResponseDto })
  generateQrPayload(@Body('deliveryId') deliveryId: string) {
    return { payload: this.workflowsService.generateQrPayload(deliveryId) };
  }

  @Post('qr/validate')
  @ApiCreatedResponse({ type: QrValidateResponseDto })
  validateQrPayload(@Body('payload') payload: string) {
    return this.workflowsService.validateQrPayload(payload);
  }
}
