import { useCart } from '@/hooks/use-cart';
import { useNearAccountId } from '@/hooks/use-near-account-id';
import { useNearPrice } from '@/hooks/use-near-price';
import { useFormPersistence } from '@/hooks/use-form-persistence';
import { useCartStore } from '@/stores/cart-store';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check, ChevronsUpDown } from 'lucide-react';
import pingpayLogoDark from '@/assets/pingpay/pingpay-logo-dark.png';
import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/utils/orpc';
import { toast } from 'sonner';
import { authClient } from '@/lib/auth-client';
import { Checkbox } from '@/components/ui/checkbox';
import { useForm } from '@tanstack/react-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Country, State } from 'country-state-city';
import type { IState } from 'country-state-city';
import { cn } from '@/lib/utils';
import {
  formatPhoneNumberInput,
  getPhoneValidationError,
  getPhonePlaceholder,
  type CountryCode,
} from '@/lib/phone';
import { isCountrySupported, isStateSupported } from '@/lib/validation/address-rules';
import {
  getPurchaseGatePluginId,
  usePurchaseGateAccessMap,
  type ProductMetadata,
  type PurchaseGatePluginId,
} from '@/integrations/api';
import {
  isFieldRequired,
  getFieldMaxLength,
  getFieldErrorMessage,
} from '@/lib/validation/address-validation';

export const Route = createFileRoute("/_marketplace/_authenticated/checkout")({
  component: CheckoutPage,
});

type ShippingQuote = Awaited<ReturnType<typeof apiClient.quote>>;
type ShippingAddress = Parameters<typeof apiClient.quote>[0]['shippingAddress'];

function CheckoutPage() {
  const { cartItems, subtotal } = useCart();
  const cartStoreItems = useCartStore((state) => state.items);
  const { data: session } = authClient.useSession();
  const { nearPrice, isLoading: isLoadingNearPrice } = useNearPrice();
  const nearAccountId = useNearAccountId();
  const [discountCode, setDiscountCode] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(null);
  const [isCalculatingShipping, setIsCalculatingShipping] = useState(false);
  const [shippingError, setShippingError] = useState<string | null>(null);
  const [availableStates, setAvailableStates] = useState<IState[]>([]);
  const [countryOpen, setCountryOpen] = useState(false);
  const [stateOpen, setStateOpen] = useState(false);
  const navigate = useNavigate();

  const persistenceScope = useMemo(() => {
    const userKey = session?.user?.id || nearAccountId;
    if (!userKey) return undefined;

    const cartFingerprint = Object.values(cartStoreItems)
      .map((item) => `${item.productId}:${item.variantId}`)
      .sort()
      .join('|');
    if (!cartFingerprint) return undefined;

    return `${userKey}::${cartFingerprint}`;
  }, [session?.user?.id, nearAccountId, cartStoreItems]);
  const gatedPluginIds = Array.from(
    new Set(
      cartItems
        .map((item) =>
          getPurchaseGatePluginId(item.product.metadata as ProductMetadata | undefined),
        )
        .filter((pluginId): pluginId is PurchaseGatePluginId => Boolean(pluginId)),
    ),
  );
  const { accessByPlugin, isLoading: isPurchaseGateLoading } =
    usePurchaseGateAccessMap(gatedPluginIds, nearAccountId);
  const providers = Array.from(
    new Set(
      cartItems
        .map((item) => item.product.fulfillmentProvider)
        .filter((provider): provider is string => Boolean(provider)),
    ),
  );
  const requiresPhone = isFieldRequired(providers, 'phone');
  const hasBlockedItems = cartItems.some((item) => {
    const pluginId = getPurchaseGatePluginId(
      item.product.metadata as ProductMetadata | undefined,
    );

    return pluginId ? !accessByPlugin.get(pluginId) : false;
  });

  const fieldRefs = useRef<Map<string, HTMLElement>>(new Map());
  const countries = useMemo(
    () => Country.getAllCountries().filter((c) => isCountrySupported(c.isoCode, providers)),
    [providers],
  );

  useEffect(() => {
    fieldRefs.current.get('firstName')?.focus();
  }, []);

  const focusField = (fieldName: string) => {
    const field = fieldRefs.current.get(fieldName);
    field?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent, nextField: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      focusField(nextField);
    }
  };

  const shippingCost = shippingQuote?.shippingCost ?? 0;
  const tax = shippingQuote?.tax ?? 0;
  const vat = shippingQuote?.vat ?? 0;
  const total = shippingQuote?.total ?? subtotal;
  const nearAmount = (total / nearPrice).toFixed(2);

  const form = useForm({
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      country: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postCode: '',
      taxId: '',
    } as ShippingAddress,
    validators: {
      onSubmit: ({ value }) => {
        if (requiresPhone && !String(value.phone || '').trim()) {
          return getFieldErrorMessage(providers, 'phone') || 'Phone number is required';
        }
        if (availableStates.length > 0 && !value.state) {
          return 'State/Province is required for the selected country';
        }
        if (value.country === 'BR' && !value.taxId) {
          return 'Tax ID (CPF/CNPJ) is required for orders to Brazil';
        }
        return undefined;
      },
    },
    onSubmit: async ({ value }) => {
      await handleCalculateShipping(value);
    },
  });

  const { clearPersistence } = useFormPersistence(form, 'checkout-form-data', {
    enabled: Boolean(persistenceScope),
    scope: persistenceScope,
  });

  const quoteMutation = useMutation({
    mutationFn: async (params: {
      items: Array<{ productId: string; variantId?: string; quantity: number }>;
      shippingAddress: {
        firstName: string;
        lastName: string;
        addressLine1: string;
        addressLine2?: string;
        city: string;
        state?: string;
        postCode: string;
        country: string;
        email: string;
        phone?: string;
      };
    }) => {
      return await apiClient.quote(params);
    },
    onSuccess: (data) => {
      setShippingQuote(data);
      setShippingError(null);
      toast.success('Shipping calculated successfully');
    },
    onError: (error: Error) => {
      setShippingError(error.message);
      setShippingQuote(null);
      toast.error(error.message || 'Failed to calculate shipping');
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (params: { formData: ShippingAddress; paymentProvider: 'stripe' | 'pingpay' }) => {
      if (cartItems.length === 0) throw new Error('Cart is empty');
      if (!shippingQuote) throw new Error('Please calculate shipping first');

      const selectedRates: Record<string, string> = {};
      shippingQuote.providerBreakdown.forEach(provider => {
        selectedRates[provider.provider] = provider.selectedShipping.rateId;
      });

        const result = await apiClient.createCheckout({
          items: cartItems.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            referralAccountId: item.referralAccountId,
          })),
          shippingAddress: params.formData,
          selectedRates,
        shippingCost: shippingQuote.shippingCost,
        successUrl: `${window.location.origin}/order-confirmation`,
        cancelUrl: `${window.location.origin}/checkout`,
        paymentProvider: params.paymentProvider,
      });
      return result;
    },
    onSuccess: (data) => {
      clearPersistence();
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        toast.error('Failed to create checkout session');
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Order Failed, please contact support (merch@near.foundation)');
    },
  });

  const handleCalculateShipping = async (formData: ShippingAddress) => {
    if (requiresPhone && !String(formData.phone || '').trim()) {
      const errorMsg = getFieldErrorMessage(providers, 'phone') || 'Phone number is required';
      setShippingError(errorMsg);
      setShippingQuote(null);
      toast.error(errorMsg);
      return;
    }

    setIsCalculatingShipping(true);

    try {
      await quoteMutation.mutateAsync({
        items: cartItems.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
        })),
        shippingAddress: {
          ...formData,
          state: String(formData.state || '') || undefined,
          addressLine2: String(formData.addressLine2 || '') || undefined,
          phone: String(formData.phone || '') || undefined,
        },
      });
    } finally {
      setIsCalculatingShipping(false);
    }
  };

  const handlePayWithPing = async () => {
    const { data: session } = await authClient.getSession();
    if (!session?.user) {
      navigate({
        to: "/login",
        search: {
          redirect: "/checkout",
        },
      });
      return;
    }

    if (!acceptedTerms) {
      toast.error('Please accept the Terms of Service to continue');
      return;
    }

    const formData = form.state.values;
    
    if (requiresPhone && !String(formData.phone || '').trim()) {
      const errorMsg = getFieldErrorMessage(providers, 'phone') || 'Phone number is required';
      setShippingError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    if (!shippingQuote) {
      await handleCalculateShipping(formData);
      return;
    }

    checkoutMutation.mutate({ formData, paymentProvider: 'pingpay' });
  };

  return (
    <div className="bg-background min-h-screen pt-32">
      <div className="max-w-[1408px] mx-auto px-4 md:px-8 lg:px-16">
        {/* Back and Title Blocks */}
        <div className="flex flex-row gap-4 mb-8">
          {/* Back Block */}
          <Link
            to="/cart"
            className="rounded-2xl border border-border/60 px-4 md:px-8 lg:px-10 py-4 md:py-8 flex items-center justify-center hover:border-[#00EC97] hover:text-[#00EC97] transition-colors shrink-0"
          >
            <ArrowLeft className="size-5" />
          </Link>

          {/* Title Block */}
          <div className="flex-1 rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-4 md:px-8 lg:px-10 py-4 md:py-8">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Shipping Address
            </h1>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Form Block */}
          <div className="rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-6 md:px-8 lg:px-10 py-6 md:py-8">
            <form className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <form.Field
                  name="firstName"
                  validators={{
                    onBlur: ({ value }) => {
                      if (!value || value.trim() === '') {
                        return 'First name is required';
                      }
                      return undefined;
                    }
                  }}
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="firstName">
                        First name <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="firstName"
                        ref={(el) => {
                          if (el) fieldRefs.current.set('firstName', el);
                        }}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, 'lastName')}
                        autoComplete="given-name"
                        required
                        className={cn(
                          "bg-background/70 border rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97]",
                          field.state.meta.errors.length > 0 && field.state.meta.isTouched ? "border-red-500" : "border-border/60 hover:border-border/60"
                        )}
                      />
                      {field.state.meta.errors.length > 0 && field.state.meta.isTouched && (
                        <p className="text-red-500 text-xs">{field.state.meta.errors}</p>
                      )}
                    </div>
                   )}
                 />

                <form.Field
                  name="lastName"
                  validators={{
                    onBlur: ({ value }) => {
                      if (!value || value.trim() === '') {
                        return 'Last name is required';
                      }
                      return undefined;
                    }
                  }}
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="lastName">
                        Last name <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="lastName"
                        ref={(el) => {
                          if (el) fieldRefs.current.set('lastName', el);
                        }}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, 'email')}
                        autoComplete="family-name"
                        required
                        className={cn(
                          "bg-background/70 border rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97]",
                          field.state.meta.errors.length > 0 && field.state.meta.isTouched ? "border-red-500" : "border-border/60 hover:border-border/60"
                        )}
                      />
                      {field.state.meta.errors.length > 0 && field.state.meta.isTouched && (
                        <p className="text-red-500 text-xs">{field.state.meta.errors}</p>
                      )}
                    </div>
                   )}
                 />
               </div>

               <form.Field
                 name="email"
                validators={{
                  onBlur: ({ value }) => {
                    if (!value || value.trim() === '') {
                      return 'Email is required';
                    }
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(value)) {
                      return 'Please enter a valid email address';
                    }
                    return undefined;
                  }
                }}
                children={(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="email">
                      Email <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      ref={(el) => {
                        if (el) fieldRefs.current.set('email', el);
                      }}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, 'phone')}
                      autoComplete="email"
                      required
                      className={cn(
                        "bg-background/70 border rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97]",
                        field.state.meta.errors.length > 0 && field.state.meta.isTouched ? "border-red-500" : "border-border/60 hover:border-border/60"
                      )}
                    />
                    {field.state.meta.errors.length > 0 && field.state.meta.isTouched && (
                      <p className="text-red-500 text-xs">{field.state.meta.errors}</p>
                    )}
                  </div>
                )}
              />

              <form.Field
                name="phone"
                validators={{
                  onBlur: ({ value }) => {
                    if (requiresPhone && !String(value || '').trim()) {
                      return getFieldErrorMessage(providers, 'phone') || 'Phone number is required';
                    }
                    if (!value) return undefined;
                    return getPhoneValidationError(
                      String(value),
                      form.state.values.country as CountryCode | undefined,
                    );
                  }
                }}
                children={(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="phone">
                      Phone {requiresPhone ? <span className="text-red-500">*</span> : null}{' '}
                      <span className="text-muted-foreground text-xs">
                        {requiresPhone
                          ? '(required for delivery)'
                          : '(optional - helps carriers reach you for delivery)'}
                      </span>
                    </Label>
                    <Input
                      id="phone"
                      type="tel"
                      ref={(el) => {
                        if (el) fieldRefs.current.set('phone', el);
                      }}
                      placeholder={getPhonePlaceholder(form.state.values.country as CountryCode | undefined)}
                      value={String(field.state.value || '')}
                      onBlur={field.handleBlur}
                      onChange={(e) => {
                        const formatted = formatPhoneNumberInput(
                          e.target.value,
                          form.state.values.country as CountryCode | undefined,
                        );
                        field.handleChange(formatted);
                      }}
                      onKeyDown={(e) => handleKeyDown(e, 'addressLine1')}
                      autoComplete="tel"
                      className={cn(
                          "bg-background/70 border rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97]",
                          field.state.meta.errors.length > 0 && field.state.meta.isTouched ? "border-red-500" : "border-border/60 hover:border-border/60"
                        )}
                      />
                      {field.state.meta.errors.length > 0 && field.state.meta.isTouched && (
                        <p className="text-red-500 text-xs">{field.state.meta.errors}</p>
                      )}
                    </div>
                  )}
                />

               <form.Field
                 name="addressLine1"
                validators={{
                  onBlur: ({ value }) => {
                    if (!value || String(value).trim() === '') {
                      return 'Street address is required';
                    }
                    const maxLength = getFieldMaxLength(providers, 'addressLine1');
                    if (maxLength && String(value).length > maxLength) {
                      return getFieldErrorMessage(providers, 'addressLine1') || 
                             `Address is too long (max ${maxLength} characters).`;
                    }
                    return undefined;
                  }
                }}
                 children={(field) => {
                   const maxLength = getFieldMaxLength(providers, 'addressLine1');
                   const currentLength = String(field.state.value || '').length;
                   
                   return (
                   <div className="space-y-2">
                     <Label htmlFor="addressLine1" className="flex justify-between">
                       <span>Street address <span className="text-red-500">*</span></span>
                       {maxLength && (
                         <span className="text-xs text-muted-foreground">
                           {currentLength}/{maxLength}
                         </span>
                       )}
                     </Label>
                     <Input
                       id="addressLine1"
                       ref={(el) => {
                         if (el) fieldRefs.current.set('addressLine1', el);
                       }}
                       placeholder="House number and street name"
                       value={field.state.value}
                       onBlur={field.handleBlur}
                       onChange={(e) => field.handleChange(e.target.value)}
                       onKeyDown={(e) => handleKeyDown(e, 'addressLine2')}
                       autoComplete="address-line1"
                       required
                       maxLength={maxLength}
                        className={cn(
                          "bg-background/70 border rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97]",
                          field.state.meta.errors.length > 0 && field.state.meta.isTouched ? "border-red-500" : "border-border/60 hover:border-border/60"
                        )}
                      />
                      {field.state.meta.errors.length > 0 && field.state.meta.isTouched && (
                        <p className="text-red-500 text-xs">{field.state.meta.errors}</p>
                      )}
                    </div>
                  );
                }}
                />

               <form.Field
                 name="addressLine2"
                validators={{
                  onBlur: ({ value }) => {
                    const maxLength = getFieldMaxLength(providers, 'addressLine2');
                    if (maxLength && String(value || '').length > maxLength) {
                      return getFieldErrorMessage(providers, 'addressLine2') || 
                             `Address Line 2 is too long (max ${maxLength} characters).`;
                    }
                    return undefined;
                  }
                }}
                 children={(field) => {
                   const maxLength = getFieldMaxLength(providers, 'addressLine2');
                   const currentLength = String(field.state.value || '').length;
                   
                   return (
                   <div className="space-y-2">
                     <Label htmlFor="addressLine2" className="flex justify-between">
                       <span>Street address 2 <span className="text-muted-foreground text-xs">(optional)</span></span>
                       {maxLength && (
                         <span className="text-xs text-muted-foreground">
                           {currentLength}/{maxLength}
                         </span>
                       )}
                     </Label>
                     <Input
                       id="addressLine2"
                       ref={(el) => {
                         if (el) fieldRefs.current.set('addressLine2', el);
                       }}
                       placeholder="Apartment, suite, unit, etc."
                       value={String(field.state.value || '')}
                       onBlur={field.handleBlur}
                       onChange={(e) => field.handleChange(e.target.value)}
                       onKeyDown={(e) => handleKeyDown(e, 'city')}
                       autoComplete="address-line2"
                       maxLength={maxLength}
                       className="bg-background/70 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97] hover:border-border/60"
                     />
                     {field.state.meta.errors.length > 0 && field.state.meta.isTouched && (
                       <p className="text-red-500 text-xs">{field.state.meta.errors}</p>
                     )}
                   </div>
                  );
                }}
               />

              <form.Field
                name="city"
                validators={{
                  onBlur: ({ value }) => {
                    if (!value || value.trim() === '') {
                      return 'Town / City is required';
                    }
                    return undefined;
                  }
                }}
                children={(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="city">
                      Town / City <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="city"
                      ref={(el) => {
                        if (el) fieldRefs.current.set('city', el);
                      }}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, 'country')}
                      autoComplete="address-level2"
                      required
                       className={cn(
                         "bg-background/70 border rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97]",
                         field.state.meta.errors.length > 0 && field.state.meta.isTouched ? "border-red-500" : "border-border/60 hover:border-border/60"
                       )}
                     />
                     {field.state.meta.errors.length > 0 && field.state.meta.isTouched && (
                       <p className="text-red-500 text-xs">{field.state.meta.errors}</p>
                     )}
                   </div>
                 )}
               />

               <form.Field
                 name="country"
                validators={{
                  onBlur: ({ value }) => {
                    if (!value) {
                      return 'Country / Region is required';
                    }
                    if (!isCountrySupported(value, providers)) {
                      return 'Shipping to this country / region is currently not supported';
                    }
                    return undefined;
                  }
                }}
                listeners={{
                  onChange: ({ value }) => {
                    if (value) {
                      const states = State.getStatesOfCountry(value).filter((s) => isStateSupported(value, s.isoCode, s.name, providers));
                      setAvailableStates(states);
                      form.setFieldValue('state', '');
                      setShippingQuote(null);
                      if (states.length > 0) {
                        setTimeout(() => focusField('state'), 100);
                      } else {
                        setTimeout(() => focusField('postCode'), 100);
                      }
                    } else {
                      setAvailableStates([]);
                      form.setFieldValue('state', '');
                    }
                  },
                }}
                children={(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="country">
                      Country / Region <span className="text-red-500">*</span>
                    </Label>
                    <Popover open={countryOpen} onOpenChange={setCountryOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          ref={(el) => {
                            if (el) fieldRefs.current.set('country', el);
                          }}
                          variant="outline"
                          role="combobox"
                          aria-expanded={countryOpen}
                          className={cn(
                            "w-full justify-between font-normal bg-background/70 border rounded-lg transition-colors",
                            field.state.meta.errors.length > 0 && field.state.meta.isTouched ? "border-red-500" : "border-border/60 hover:border-[#00EC97] focus-visible:border-[#00EC97]"
                          )}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setCountryOpen(true);
                            }
                          }}
                        >
                          {field.state.value
                            ? countries.find((c) => c.isoCode === field.state.value)?.flag + ' ' +
                            countries.find((c) => c.isoCode === field.state.value)?.name
                            : "Select a country / region..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent side="bottom" align="start" className="w-full p-0">
                        <Command>
                          <CommandInput placeholder="Search country..." autoFocus />
                          <CommandList>
                            <CommandEmpty>No country found.</CommandEmpty>
                            <CommandGroup>
                              {countries.map((country) => (
                                <CommandItem
                                  key={country.isoCode}
                                  value={country.name}
                                  onSelect={() => {
                                    field.handleChange(country.isoCode);
                                    setCountryOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      field.state.value === country.isoCode ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  {country.flag} {country.name}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {field.state.meta.errors.length > 0 && field.state.meta.isTouched && (
                      <p className="text-red-500 text-xs">{field.state.meta.errors}</p>
                    )}
                  </div>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                {availableStates.length > 0 && (
                  <form.Field
                    name="state"
                    validators={{
                      onBlur: ({ value }) => {
                        if (availableStates.length > 0 && !value) {
                          return 'State / Province is required';
                        }
                        if (value && !isStateSupported(form.state.values.country, value, undefined, providers)) {
                          return 'Delivery is not available for this region';
                        }
                        return undefined;
                      }
                    }}
                    listeners={{
                      onChange: () => {
                        setTimeout(() => focusField('postCode'), 100);
                      },
                    }}
                    children={(field) => (
                      <div className="space-y-2">
                        <Label htmlFor="state">
                          State / Province <span className="text-red-500">*</span>
                        </Label>
                        <Popover open={stateOpen} onOpenChange={setStateOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              ref={(el) => {
                                if (el) fieldRefs.current.set('state', el);
                              }}
                              variant="outline"
                              role="combobox"
                              aria-expanded={stateOpen}
                               className={cn(
                                 "w-full justify-between font-normal bg-background/70 border rounded-lg transition-colors",
                                 field.state.meta.errors.length > 0 && field.state.meta.isTouched ? "border-red-500" : "border-border/60 hover:border-[#00EC97] focus-visible:border-[#00EC97]"
                               )}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setStateOpen(true);
                                }
                              }}
                            >
                              {field.state.value
                                ? availableStates.find((s) => s.isoCode === String(field.state.value))?.name
                                : "Select a state..."}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent side="bottom" align="start" className="w-full p-0">
                            <Command>
                              <CommandInput placeholder="Search state..." autoFocus />
                              <CommandList>
                                <CommandEmpty>No state found.</CommandEmpty>
                                <CommandGroup>
                                  {availableStates.map((state) => (
                                    <CommandItem
                                      key={state.isoCode}
                                      value={state.name}
                                      onSelect={() => {
                                        field.handleChange(state.isoCode);
                                        setStateOpen(false);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          "mr-2 h-4 w-4",
                                          field.state.value === state.isoCode ? "opacity-100" : "opacity-0"
                                        )}
                                      />
                                      {state.name}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                         </Popover>
                         {field.state.meta.errors.length > 0 && field.state.meta.isTouched && (
                           <p className="text-red-500 text-xs">{field.state.meta.errors}</p>
                         )}
                       </div>
                     )}
                   />
                 )}

                  <form.Field
                    name="postCode"
                   validators={{
                     onBlur: ({ value }) => {
                       if (!value || String(value).trim() === '') {
                         return 'ZIP / Postal Code is required';
                       }
                       const maxLength = getFieldMaxLength(providers, 'postcode');
                       if (maxLength && String(value).length > maxLength) {
                         return getFieldErrorMessage(providers, 'postcode') || 
                                `ZIP/Postal code is too long (max ${maxLength} characters).`;
                       }
                       return undefined;
                     }
                   }}
                   children={(field) => {
                     const maxLength = getFieldMaxLength(providers, 'postcode');
                     const currentLength = String(field.state.value || '').length;
                     
                     return (
                     <div className="space-y-2">
                       <Label htmlFor="postCode" className="flex justify-between">
                         <span>ZIP / Postal Code <span className="text-red-500">*</span></span>
                         {maxLength && (
                           <span className="text-xs text-muted-foreground">
                             {currentLength}/{maxLength}
                           </span>
                         )}
                       </Label>
                       <Input
                         id="postCode"
                         ref={(el) => {
                           if (el) fieldRefs.current.set('postCode', el);
                         }}
                         value={field.state.value}
                         onBlur={field.handleBlur}
                         onChange={(e) => field.handleChange(e.target.value)}
                         autoComplete="postal-code"
                         required
                         maxLength={maxLength}
                        className={cn(
                          "bg-background/70 border rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97]",
                          field.state.meta.errors.length > 0 && field.state.meta.isTouched ? "border-red-500" : "border-border/60 hover:border-border/60"
                        )}
                      />
                      {field.state.meta.errors.length > 0 && field.state.meta.isTouched && (
                        <p className="text-red-500 text-xs">{field.state.meta.errors}</p>
                      )}
                    </div>
                  );
                }}
                />
              </div>

              {form.state.values.country === 'BR' && (
                <form.Field
                  name="taxId"
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="taxId">
                        Tax ID (CPF/CNPJ) <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="taxId"
                        ref={(el) => {
                          if (el) fieldRefs.current.set('taxId', el);
                        }}
                        value={String(field.state.value || '')}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          let value = e.target.value.replace(/[^\d]/g, '');
                          if (value.length <= 11) {
                            value = value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
                          } else if (value.length <= 14) {
                            value = value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
                          }
                          field.handleChange(value);
                        }}
                        placeholder="000.000.000-00 or 00.000.000/0000-00"
                        maxLength={18}
                        required
                        className="bg-background/70 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97] hover:border-border/60"
                      />
                      <p className="text-xs text-muted-foreground">
                        CPF (Individual): 000.000.000-00 • CNPJ (Business): 00.000.000/0000-00
                      </p>
                    </div>
                  )}
                />
              )}

              {form.state.values.country === 'CL' && (
                <form.Field
                  name="taxId"
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="taxId">
                        RUT (Tax ID) <span className="text-muted-foreground text-xs">(Recommended)</span>
                      </Label>
                      <Input
                        id="taxId"
                        ref={(el) => {
                          if (el) fieldRefs.current.set('taxId', el);
                        }}
                        value={String(field.state.value || '')}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          let value = e.target.value.replace(/[^\dkK]/gi, '');
                          if (value.length > 1) {
                            value = value.slice(0, -1).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1.') + '-' + value.slice(-1);
                          }
                          field.handleChange(value);
                        }}
                        placeholder="12.345.678-5"
                        maxLength={12}
                        className="bg-background/70 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97] hover:border-border/60"
                      />
                      <p className="text-xs text-muted-foreground">
                        Chilean RUT format: 00.000.000-X
                      </p>
                    </div>
                  )}
                />
              )}

              {form.state.values.country === 'KR' && (
                <form.Field
                  name="taxId"
                  children={(field) => (
                    <div className="space-y-2">
                      <Label htmlFor="taxId">
                        PCC (Personal Customs Code) <span className="text-muted-foreground text-xs">(Recommended)</span>
                      </Label>
                      <Input
                        id="taxId"
                        ref={(el) => {
                          if (el) fieldRefs.current.set('taxId', el);
                        }}
                        value={String(field.state.value || '')}
                        onBlur={field.handleBlur}
                        onChange={(e) => {
                          let value = e.target.value.toUpperCase().replace(/[^P\d]/g, '');
                          if (value && !value.startsWith('P')) {
                            value = 'P' + value;
                          }
                          field.handleChange(value.slice(0, 13));
                        }}
                        placeholder="P000000000000"
                        maxLength={13}
                        className="bg-background/70 border border-border/60 rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97] hover:border-border/60"
                      />
                      <p className="text-xs text-muted-foreground">
                        Required for customs clearance in South Korea
                      </p>
                    </div>
                  )}
                />
              )}

              <div className="pt-6">
                <Button
                  type="button"
                  onClick={() => {
                    handleCalculateShipping(form.state.values);
                  }}
                  disabled={isCalculatingShipping || quoteMutation.isPending}
                  variant={shippingQuote ? "outline" : "default"}
                  className={cn(
                    "w-full transition-colors",
                    shippingQuote 
                      ? "bg-background border-border/60 hover:border-[#00EC97] hover:text-[#00EC97]" 
                      : "bg-[#00EC97] text-black hover:bg-[#00d97f]"
                  )}
                  size="lg"
                >
                  {isCalculatingShipping || quoteMutation.isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="animate-spin size-4 border-2 border-current border-t-transparent rounded-full" />
                      Calculating Shipping...
                    </span>
                  ) : shippingQuote ? (
                    'Recalculate Shipping'
                  ) : (
                    'Calculate Shipping'
                  )}
                </Button>
                {shippingQuote && (
                  <p className="text-sm text-[#00EC97] mt-2 text-center font-medium">
                    ✓ Shipping calculated: ${shippingCost.toFixed(2)}
                  </p>
                )}
                {shippingError && (
                  <div className="mt-3 p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg">
                    <div className="flex gap-2">
                      <span className="text-red-600 dark:text-red-400 font-semibold shrink-0">⚠</span>
                      <div
                        className="text-sm text-red-800 dark:text-red-300"
                        dangerouslySetInnerHTML={{ __html: shippingError }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </form>
          </div>

          {/* Order Summary Block */}
          <div className="space-y-6">
            <div className="rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-6 md:px-8 lg:px-10 py-6 md:py-8" data-testid="order-summary">
              <div className="mb-6">
                <h2 className="text-xl md:text-2xl font-bold tracking-tight mb-6">Order Summary</h2>

                <div className="space-y-4">
                  {cartItems.map((item) => {
                    // Filter out mockup images and use only variant images
                    const variantImages = item.product.images?.filter(
                      (img) => img.type !== "mockup" && img.type !== "detail" && img.variantIds && img.variantIds.length > 0
                    ) || [];
                    const displayImage = 
                      variantImages[0]?.url ||
                      item.product.variants?.[0]?.fulfillmentConfig?.files?.[0]?.url ||
                      item.product.images?.find((img) => img.type !== "mockup" && img.type !== "detail")?.url;
                    
                    return (
                    <div key={item.productId} className="flex gap-4">
                      <div className="relative size-20 bg-muted border border-border/60 shrink-0 overflow-hidden rounded-lg">
                        <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/40 to-background/90 dark:from-background/10 dark:via-background/60 dark:to-background z-0"></div>
                        {displayImage ? (
                          <img
                            src={displayImage}
                            alt={item.product.title}
                            loading="lazy"
                            decoding="async"
                            width={80}
                            height={80}
                            className="size-full object-cover relative z-10"
                          />
                        ) : (
                          <div className="size-full flex items-center justify-center text-foreground/50 dark:text-muted-foreground relative z-10">
                            No Image
                          </div>
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="text-base mb-1">{item.product.title}</p>
                        <p className="text-sm text-foreground/70 dark:text-muted-foreground">
                          {item.size !== "N/A" && `Size: ${item.size} • `}Qty:{" "}
                          {item.quantity}
                        </p>
                      </div>
                      <div className="text-base text-right">
                        ${(item.unitPrice * item.quantity).toFixed(2)}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>

              <div className="h-px bg-border my-6" />

              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/70 dark:text-muted-foreground">Subtotal</span>
                  <span className="text-foreground/90 dark:text-muted-foreground">${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/70 dark:text-muted-foreground">Shipping</span>
                  <span className="text-foreground/90 dark:text-muted-foreground">
                    {isCalculatingShipping ? (
                      <span className="flex items-center gap-1.5">
                        <div className="animate-spin size-3 border-2 border-current border-t-transparent rounded-full" />
                        Calculating...
                      </span>
                    ) : shippingQuote ? (
                      `$${shippingCost.toFixed(2)}`
                    ) : (
                      <span className="text-foreground/50 dark:text-muted-foreground">
                        Click "Calculate Shipping"
                      </span>
                    )}
                  </span>
                </div>
                {shippingQuote?.estimatedDelivery && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/70 dark:text-muted-foreground">Estimated Delivery</span>
                    <span className="text-xs text-foreground/70 dark:text-muted-foreground">
                      {shippingQuote.estimatedDelivery.minDays}-{shippingQuote.estimatedDelivery.maxDays} business days
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/70 dark:text-muted-foreground">Tax</span>
                  <span className="text-foreground/90 dark:text-muted-foreground">
                    {isCalculatingShipping ? (
                      <span className="text-foreground/50 dark:text-muted-foreground">Calculating...</span>
                    ) : shippingQuote ? (
                      `$${tax.toFixed(2)}`
                    ) : (
                      <span className="text-foreground/50 dark:text-muted-foreground">Calculated with quote</span>
                    )}
                  </span>
                </div>
                {vat > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/70 dark:text-muted-foreground">VAT</span>
                    <span className="text-foreground/90 dark:text-muted-foreground">
                      {isCalculatingShipping ? (
                        <span className="text-foreground/50 dark:text-muted-foreground">Calculating...</span>
                      ) : shippingQuote ? (
                        `$${vat.toFixed(2)}`
                      ) : (
                        <span className="text-foreground/50 dark:text-muted-foreground">Calculated with quote</span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              <div className="h-px bg-border/60 mb-3" />

              <div className="flex justify-between items-start">
                <span className="text-lg font-semibold">Total</span>
                <div className="text-right">
                  <p className="text-lg font-semibold">${total.toFixed(2)}</p>
                  <p className="text-sm text-[#00EC97] font-medium">
                    {isLoadingNearPrice ? '...' : `≈ ${nearAmount} NEAR`}
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 p-4 flex flex-col sm:flex-row sm:items-center items-start justify-between gap-4">
                <span className="text-sm text-foreground/90 dark:text-muted-foreground">Apply Discount Code</span>
                <input
                  type="text"
                  placeholder="Enter Code"
                  value={discountCode}
                  onChange={(e) => setDiscountCode(e.target.value)}
                  className="bg-background/70 border border-border/60 px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-[#00EC97] hover:border-border/60 transition-colors w-full sm:w-60 rounded-lg focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
            </div>

            {/* Terms Checkbox Block */}
            <div className="rounded-2xl bg-[#00EC97]/5 dark:bg-[#00EC97]/10 border-l-4 border-[#00EC97] px-6 md:px-8 lg:px-10 py-6 md:py-8">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="terms"
                  checked={acceptedTerms}
                  onCheckedChange={(checked) => setAcceptedTerms(checked as boolean)}
                  className="mt-0.5 data-[state=checked]:bg-[#00EC97] data-[state=checked]:border-[#00EC97]"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <label
                      htmlFor="terms"
                      className="text-sm font-medium cursor-pointer select-none"
                    >
                      Terms of Service
                    </label>
                    <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2 py-0.5 rounded-full font-medium">
                      Required
                    </span>
                  </div>
                  <label
                    htmlFor="terms"
                    className="text-sm text-muted-foreground cursor-pointer select-none"
                  >
                    By checking this box, you agree to our{' '}
                    <Link
                      to="/terms-of-service"
                      className="underline hover:text-[#00EC97] transition-colors"
                    >
                      Terms of Service
                    </Link>
                  </label>
                </div>
              </div>
            </div>

            {/* Payment Method Block */}
            <div className="rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-6 md:px-8 lg:px-10 py-6 md:py-8">
              <h2 className="text-xl md:text-2xl font-bold tracking-tight mb-6">
                Choose Payment Method
              </h2>

              <div className="space-y-4">
                <form.Subscribe
                  selector={(state) => ({
                    canSubmit: state.canSubmit,
                    hasErrors: Object.keys(state.errors || {}).length > 0
                  })}
                  children={({ canSubmit, hasErrors }) => {
                    const isFormValid = canSubmit && !hasErrors;
                    const hasShippingQuote = !!shippingQuote;
                    const hasAcceptedTerms = acceptedTerms;
                    
                    const getDisabledState = () => {
                      if (!isFormValid) {
                        return { disabled: true, reason: 'Complete all required fields' };
                      }
                      if (!hasShippingQuote) {
                        return { disabled: true, reason: 'Shipping calculation required' };
                      }
                      if (!hasAcceptedTerms) {
                        return { disabled: true, reason: 'Please accept the Terms of Service' };
                      }
                      if (hasBlockedItems) {
                        return {
                          disabled: true,
                          reason: isPurchaseGateLoading
                            ? 'Checking Legion holder access'
                            : 'Your account cannot purchase one or more Legion-gated items',
                        };
                      }
                      return { disabled: false, reason: '' };
                    };
                    
                    const { disabled, reason } = getDisabledState();
                    
                    return (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={handlePayWithPing}
                            disabled={disabled || checkoutMutation.isPending}
                            type="button"
                            style={{
                              '--ping-bg': '#F9F7FF',
                              '--ping-text': '#3D315E',
                              '--ping-border': '#AF9EF9',
                              '--ping-border-hover': '#AF9EF9',
                              '--ping-ring': 'rgba(175, 158, 249, 0.35)',
                            } as CSSProperties}
                            className={cn(
                              'group flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 px-6 text-sm font-semibold transition-colors',
                              'bg-[color:var(--ping-bg)] border-[color:var(--ping-border)] text-[color:var(--ping-text)]',
                              'hover:border-[color:var(--ping-border-hover)]',
                              'shadow-sm hover:shadow',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ping-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                              disabled && 'opacity-50 cursor-not-allowed hover:shadow-sm'
                            )}
                            data-testid="pay-with-card-button"
                            aria-label={checkoutMutation.isPending ? 'Redirecting to PingPay' : 'Pay with PingPay'}
                          >
                            {checkoutMutation.isPending ? (
                              <span className="flex items-center justify-center gap-2">
                                <span className="animate-spin size-4 rounded-full border-2 border-[color:var(--ping-border)] border-t-[color:var(--ping-text)]" />
                                Redirecting...
                              </span>
                            ) : (
                              <span className="flex items-center justify-center gap-2">
                                <span>Pay with</span>
                                <span className="inline-flex items-center">
                                  <img
                                    src={pingpayLogoDark}
                                    alt="PingPay"
                                    loading="eager"
                                    decoding="async"
                                    className="h-5 w-auto object-contain"
                                  />
                                </span>
                              </span>
                            )}
                          </button>
                        </TooltipTrigger>
                        {disabled && (
                          <TooltipContent side="top" className="max-w-xs">
                            <p>{reason}</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    );
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
