import { expectTypeOf, test } from 'vitest'
import type {
  AssumedValue,
  BusinessAuthorityValue,
  MeasurementState,
  ModeledValue,
  ObservedValue,
  PricingDerivedValue,
  PresentMeasurement,
} from '../../lib/narrative-qa/reliability'

type IsAssignable<From, To> = [From] extends [To] ? true : false
type AssertFalse<T extends false> = T

type _ObservedNotAssumed = AssertFalse<IsAssignable<ObservedValue<string>, AssumedValue<string>>>
type _ObservedNotModeled = AssertFalse<IsAssignable<ObservedValue<string>, ModeledValue<string>>>
type _ObservedNotPricing = AssertFalse<IsAssignable<ObservedValue<string>, PricingDerivedValue<string>>>
type _ObservedNotBusiness = AssertFalse<IsAssignable<ObservedValue<string>, BusinessAuthorityValue<string>>>
type _AssumedNotModeled = AssertFalse<IsAssignable<AssumedValue<string>, ModeledValue<string>>>
type _AssumedNotPricing = AssertFalse<IsAssignable<AssumedValue<string>, PricingDerivedValue<string>>>
type _AssumedNotBusiness = AssertFalse<IsAssignable<AssumedValue<string>, BusinessAuthorityValue<string>>>
type _ModeledNotPricing = AssertFalse<IsAssignable<ModeledValue<string>, PricingDerivedValue<string>>>
type _ModeledNotBusiness = AssertFalse<IsAssignable<ModeledValue<string>, BusinessAuthorityValue<string>>>
type _PricingNotBusiness = AssertFalse<IsAssignable<PricingDerivedValue<string>, BusinessAuthorityValue<string>>>
type _MeasurementNotPresent = AssertFalse<IsAssignable<MeasurementState<string>, PresentMeasurement<string>>>

void (0 as unknown as _ObservedNotAssumed)
void (0 as unknown as _ObservedNotModeled)
void (0 as unknown as _ObservedNotPricing)
void (0 as unknown as _ObservedNotBusiness)
void (0 as unknown as _AssumedNotModeled)
void (0 as unknown as _AssumedNotPricing)
void (0 as unknown as _AssumedNotBusiness)
void (0 as unknown as _ModeledNotPricing)
void (0 as unknown as _ModeledNotBusiness)
void (0 as unknown as _PricingNotBusiness)
void (0 as unknown as _MeasurementNotPresent)

test('provenance values expose readonly nominal contracts', () => {
  expectTypeOf<ObservedValue<string>>().not.toEqualTypeOf<AssumedValue<string>>()
  expectTypeOf<PricingDerivedValue<string>>().not.toEqualTypeOf<BusinessAuthorityValue<string>>()
})
