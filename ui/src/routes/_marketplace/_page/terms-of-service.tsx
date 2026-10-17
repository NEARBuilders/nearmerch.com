import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_marketplace/_page/terms-of-service")({
  component: TermsOfService,
});

function TermsOfService() {
  return (
    <div className="space-y-8">
      {/* Back and Title Blocks */}
      <div className="flex flex-row gap-4">
        {/* Back Block */}
        <Link
          to="/"
          className="rounded-2xl border border-border/60 px-4 md:px-8 lg:px-10 py-4 md:py-8 flex items-center justify-center hover:border-[#00EC97] hover:text-[#00EC97] transition-colors shrink-0"
        >
          <ArrowLeft className="size-5" />
        </Link>

        {/* Title Block */}
        <div className="flex-1 rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-4 md:px-8 lg:px-10 py-4 md:py-8">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">Terms of Service</h1>
          <p className="text-sm md:text-base text-foreground/90 dark:text-muted-foreground">
        Last updated: January 12, 2026
      </p>
        </div>
      </div>

      {/* Content Block */}
      <div className="rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-6 md:px-8 lg:px-10 py-8 md:py-10">
      <p className="text-foreground/90 dark:text-muted-foreground mb-6">
        These Terms of Service ("Terms") govern your use of the NEAR Merch Store operated by 
        NEAR Foundation ("we", "us", "our"). By placing an order or using our store, you agree 
        to these Terms.
      </p>

      <p className="text-foreground/90 dark:text-muted-foreground mb-6">
        These Terms apply specifically to the NEAR Merch Store. For NEAR's general terms, 
        please also review the{" "}
        <a
          href="https://near.org/terms-of-use"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#00EC97] hover:underline transition-colors"
        >
          NEAR Terms of Use
        </a>
        .
      </p>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">1. Acceptance of Terms</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          By accessing or using the NEAR Merch Store, you agree to be bound by these Terms 
          and our{" "}
          <Link to="/privacy-policy" className="text-[#00EC97] hover:underline transition-colors">
            Privacy Policy
          </Link>
          . If you do not agree to these Terms, you must not use our store.
        </p>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          You must be at least 18 years old to use this store.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">2. Merchant of Record</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          NEAR Foundation is the merchant of record for all purchases made through this store. 
          All orders are subject to acceptance by NEAR Foundation.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">3. Products and Pricing</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          All products are made to order by third-party fulfillment partners. Product images 
          are representative and actual products may vary slightly.
        </p>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          Prices are displayed in USD unless otherwise indicated. We reserve the right to 
          change prices at any time without notice. Prices do not include applicable taxes 
          and shipping costs, which are calculated at checkout.
        </p>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          We make every effort to display accurate product information, but we do not warrant 
          that descriptions, pricing, or other content is accurate, complete, or error-free.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">4. Orders and Payments</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          By placing an order, you make an offer to purchase the products. We reserve the 
          right to refuse or cancel any order for any reason, including product availability, 
          errors in pricing or product information, or suspected fraud.
        </p>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          We accept payment via credit/debit cards through Stripe and cryptocurrency payments 
          (including USDC on NEAR) through Pingpay. Agent and API clients may also pay in USDC 
          on Base through x402. x402 payments settle onchain to the store treasury and are not 
          a hosted checkout redirect. Payment is required at the time of order.
        </p>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          If you pay with cryptocurrency, the conversion rate is determined at checkout. Due 
          to market volatility, the fiat equivalent may differ from the displayed price at 
          the time of conversion. Onchain x402 settlement is final at the protocol level.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">5. Shipping and Delivery</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          Products are fulfilled and shipped by our third-party fulfillment partners from 
          the facility nearest to your shipping address.
        </p>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          Estimated delivery times are provided at checkout but are not guaranteed. Delivery 
          times may be affected by production times, carrier delays, customs processing, and 
          other factors beyond our control.
        </p>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          Risk of loss and title for items pass to you upon delivery to the carrier. You are 
          responsible for providing accurate shipping information.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">6. Returns and Refunds</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          Due to the made-to-order nature of our products, we do not accept returns for 
          buyer's remorse or size exchanges.
        </p>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          Refunds or replacements may be issued for products that are damaged, defective, 
          misprinted, or lost in transit. Claims must be submitted within 30 days of receipt 
          or estimated delivery date. x402 / onchain payments are not refundable beyond this 
          merchant policy and are not reversed by the payment protocol itself.
        </p>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          For complete details, see our{" "}
          <Link to="/refunds-returns" className="text-[#00EC97] hover:underline transition-colors">
            Refunds &amp; Returns Policy
          </Link>
          .
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">7. Account and Wallet Connection</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          You may connect your NEAR wallet to access certain features. You are responsible 
          for maintaining the security of your wallet and any transactions made using it.
        </p>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          We are not responsible for any loss or damage arising from unauthorized access to 
          your wallet or transactions you did not intend to make.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">8. Intellectual Property</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          All content on this store, including designs, logos, text, and images, is the 
          property of NEAR Foundation or its licensors and is protected by intellectual 
          property laws. You may not reproduce, distribute, or create derivative works 
          without our express written permission.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">9. Prohibited Uses</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          You agree not to:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-foreground/90 dark:text-muted-foreground mb-4">
          <li>Use the store for any unlawful purpose</li>
          <li>Attempt to gain unauthorized access to our systems</li>
          <li>Interfere with or disrupt the store's operation</li>
          <li>Use automated systems to access the store without permission</li>
          <li>Provide false or misleading information</li>
          <li>Resell products purchased from this store without authorization</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">10. Disclaimer of Warranties</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          THE STORE AND PRODUCTS ARE PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, 
          EXPRESS OR IMPLIED. WE DISCLAIM ALL WARRANTIES, INCLUDING IMPLIED WARRANTIES 
          OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
        </p>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          We do not warrant that the store will be uninterrupted, error-free, or secure.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">11. Limitation of Liability</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEAR FOUNDATION SHALL NOT BE LIABLE FOR 
          ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING 
          FROM YOUR USE OF THE STORE OR PRODUCTS, INCLUDING BUT NOT LIMITED TO LOSS OF 
          PROFITS, DATA, OR GOODWILL.
        </p>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          Our total liability for any claims arising from your use of the store shall not 
          exceed the amount you paid for the products giving rise to the claim.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">12. Indemnification</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          You agree to indemnify and hold harmless NEAR Foundation and its affiliates, 
          officers, directors, employees, and agents from any claims, damages, losses, 
          or expenses arising from your use of the store or violation of these Terms.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">13. Governing Law</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          These Terms shall be governed by and construed in accordance with the laws of 
          Switzerland, without regard to its conflict of law provisions.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">14. Changes to Terms</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          We may modify these Terms at any time. Changes will be effective when posted on 
          this page with an updated "Last updated" date. Your continued use of the store 
          after changes constitutes acceptance of the modified Terms.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">15. Contact</h2>
        <p className="text-foreground/90 dark:text-muted-foreground mb-4">
          For questions about these Terms, contact us at:
        </p>
        <ul className="list-none space-y-2 text-foreground/90 dark:text-muted-foreground mb-4">
          <li>
            General inquiries:{" "}
            <a
              href="mailto:merch@near.foundation"
              className="text-[#00EC97] hover:underline transition-colors"
            >
              merch@near.foundation
            </a>
          </li>
          <li>
            Legal inquiries:{" "}
            <a
              href="mailto:legal@near.org"
              className="text-[#00EC97] hover:underline transition-colors"
            >
              legal@near.org
            </a>
          </li>
        </ul>
      </section>

        <hr className="border-t border-border/60 my-6" />

        <p className="text-foreground/90 dark:text-muted-foreground">
        See also: NEAR's general{" "}
        <a
          href="https://near.org/terms-of-use"
          target="_blank"
          rel="noopener noreferrer"
            className="text-[#00EC97] hover:underline transition-colors"
        >
          Terms of Use
        </a>
      </p>
      </div>
    </div>
  );
}
