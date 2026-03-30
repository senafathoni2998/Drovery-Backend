import { IsNotEmpty, IsString } from 'class-validator';

export class CompleteStepDto {
  @IsString()
  @IsNotEmpty()
  workflowId: string;

  @IsString()
  @IsNotEmpty()
  stepId: string;
}
