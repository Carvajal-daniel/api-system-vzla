import * as crypto from 'crypto';
import {
  assertValidIanaTimeZone,
  DEFAULT_COMPANY_TIMEZONE,
} from '../../../appointments/domain/services/timezone-utils.js';

export interface CompanyProps {
  id: string; 
  companyName: string;
  name: string;
  phone: string;
  email: string;      
  password: string;
  isActive: boolean;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}




export type CreateCompanyProps = Omit<
  CompanyProps, 
  'id' | 'isActive' | 'timezone' | 'createdAt' | 'updatedAt'
> & {
  timezone?: string | undefined;
};



export class CompanyEntity {
  private constructor(
    private readonly props: CompanyProps
  ) {}

  
  static create(props: CreateCompanyProps): CompanyEntity {
    const now = new Date();
    const timezone = assertValidIanaTimeZone(
      props.timezone ?? DEFAULT_COMPANY_TIMEZONE,
    );
    return new CompanyEntity({
      ...props,
      id: crypto.randomUUID(),
      isActive: true,
      timezone,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: CompanyProps): CompanyEntity{
    return new CompanyEntity(props);
  }

  suspendForNonPayment(): void {
    if(!this.props.isActive) return;
    this.props.isActive = false;
    this.props.updatedAt = new Date();
  }

  reactivate(): void {
    if(this.props.isActive) return;
    this.props.isActive = true;
    this.props.updatedAt = new Date();
  }


  get id(): string { return this.props.id; }
  get companyName(): string { return this.props.companyName; }
  get name(): string { return this.props.name; }
  get phone(): string { return this.props.phone; }
  get email(): string { return this.props.email; }
  get password(): string { return this.props.password; }
  get isActive(): boolean { return this.props.isActive; }
  get timezone(): string { return this.props.timezone; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }
}
