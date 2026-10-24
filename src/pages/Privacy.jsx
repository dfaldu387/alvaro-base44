import React from 'react';
import LegalPage, { LegalSection } from '@/components/legal/LegalPage';

// Privacy Policy. Describes what the app genuinely stores, who it shares with,
// and what it does not do.
export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="18 October 2026">
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p>
          Cut Deluxe Barbering respects your privacy and aims to handle personal information
          transparently and responsibly.
        </p>
        <p>
          This Privacy Policy explains what information we collect, why we collect it, how we use
          it, who we may share it with, and the choices available to you.
        </p>
      </div>

      <LegalSection heading="1. What we collect">
        <p>When you use Cut Deluxe, we may collect information such as:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>your name</li>
          <li>mobile number</li>
          <li>email address</li>
          <li>service address</li>
          <li>latitude and longitude associated with that address</li>
          <li>services selected</li>
          <li>booking date and availability window</li>
          <li>booking and appointment history</li>
          <li>payment status and transaction references</li>
          <li>messages exchanged with Cut Deluxe</li>
          <li>notes you choose to provide</li>
          <li>rebooking frequency and reminder history</li>
        </ul>
        <p>
          Where relevant to the service, you may also choose to tell us about matters such as scalp
          conditions, allergies or recent treatments.
        </p>
      </LegalSection>

      <LegalSection heading="2. How we collect information">
        <p>We generally collect information directly from you when you:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>submit a booking request</li>
          <li>send us a message</li>
          <li>make or receive a payment</li>
          <li>update your details</li>
          <li>communicate with Cut Deluxe about an appointment</li>
        </ul>
        <p>
          We may also receive limited information from service providers that help us operate the
          business, such as payment, messaging, mapping and hosting providers.
        </p>
      </LegalSection>

      <LegalSection heading="3. Location information">
        <p>Cut Deluxe uses location information to operate a mobile barbering service.</p>
        <p>This may include:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>the appointment address you provide</li>
          <li>map coordinates for that address</li>
          <li>estimated travel time between appointments</li>
          <li>the barber&apos;s current location while travelling to appointments</li>
        </ul>
        <p>Customer location is used for booking, routing and service delivery.</p>
        <p>
          Where live barber location is used, it is intended to support route management, estimated
          arrival times and customer updates.
        </p>
        <p>We do not use customer location information for unrelated advertising.</p>
      </LegalSection>

      <LegalSection heading="4. Payments">
        <p>We do not directly store your full card details.</p>
        <p>Payments are processed by third-party payment providers such as Square.</p>
        <p>We may store limited payment information such as:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>whether payment succeeded</li>
          <li>amount</li>
          <li>payment status</li>
          <li>transaction reference</li>
          <li>refund status</li>
        </ul>
        <p>Full payment-card details are handled by the payment provider.</p>
      </LegalSection>

      <LegalSection heading="5. Why we use your information">
        <p>We use personal information to:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>process booking requests</li>
          <li>schedule appointments</li>
          <li>plan routes</li>
          <li>provide mobile barbering services</li>
          <li>contact you about bookings</li>
          <li>send confirmations and reminders</li>
          <li>calculate estimated arrival times</li>
          <li>process and track payments</li>
          <li>manage cancellations and refunds</li>
          <li>maintain customer history</li>
          <li>identify when regular customers may be due for another appointment</li>
          <li>improve the operation and reliability of Cut Deluxe</li>
          <li>respond to questions or complaints</li>
        </ul>
      </LegalSection>

      <LegalSection heading="6. Automated systems">
        <p>Cut Deluxe may use automated software to assist with:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>appointment scheduling</li>
          <li>Route Flow optimisation</li>
          <li>reminders</li>
          <li>customer messages</li>
          <li>rebooking campaigns</li>
          <li>payment updates</li>
          <li>administrative tasks</li>
        </ul>
        <p>Some routine decisions or messages may be generated automatically.</p>
        <p>
          Where an issue requires judgment or manual attention, it may be escalated to a person.
        </p>
        <p>
          From 10 December 2026, additional Privacy Act transparency requirements apply to some
          organisations using computer programs in decisions that could significantly affect a
          person&apos;s rights or interests. Cut Deluxe should revisit this section before public
          launch if those rules apply to the business.
        </p>
      </LegalSection>

      <LegalSection heading="7. Messages and consent">
        <p>
          We may send service-related messages needed to manage an existing booking, including:
        </p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>booking received messages</li>
          <li>confirmations</li>
          <li>appointment reminders</li>
          <li>arrival updates</li>
          <li>changes</li>
          <li>cancellations</li>
          <li>payment information</li>
          <li>receipts</li>
        </ul>
        <p>Where permitted, we may also send:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>rebooking reminders</li>
          <li>follow-ups</li>
          <li>availability messages</li>
          <li>promotional messages</li>
        </ul>
        <p>
          You can opt out of promotional or rebooking messages by replying STOP or using another
          unsubscribe method we provide.
        </p>
        <p>
          We record opt-out preferences so that future reminder and promotional campaigns can
          respect them.
        </p>
      </LegalSection>

      <LegalSection heading="8. Who we share information with">
        <p>We use third-party providers to operate Cut Deluxe.</p>
        <p>These may include providers for:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>messaging</li>
          <li>payments</li>
          <li>mapping</li>
          <li>routing</li>
          <li>geocoding</li>
          <li>hosting</li>
          <li>database storage</li>
          <li>software infrastructure</li>
        </ul>
        <p>
          Each provider receives information only to the extent reasonably necessary to provide its
          service.
        </p>
        <p>We do not sell personal information.</p>
        <p>
          We do not share personal information with third parties for their own unrelated
          advertising purposes.
        </p>
      </LegalSection>

      <LegalSection heading="9. How we store and protect information">
        <p>
          Customer information is stored using the systems and hosting providers that support Cut
          Deluxe.
        </p>
        <p>
          We use reasonable technical and organisational measures to protect personal information
          from:
        </p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>unauthorised access</li>
          <li>misuse</li>
          <li>loss</li>
          <li>alteration</li>
          <li>disclosure</li>
        </ul>
        <p>No online system can be guaranteed completely secure.</p>
      </LegalSection>

      <LegalSection heading="10. How long we keep information">
        <p>We keep personal information only for as long as reasonably required for:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>providing services</li>
          <li>maintaining booking history</li>
          <li>calculating rebooking frequency</li>
          <li>payment and accounting records</li>
          <li>resolving complaints or disputes</li>
          <li>legal and regulatory obligations</li>
        </ul>
        <p>
          Information that is no longer reasonably required will be deleted, de-identified or
          otherwise handled in accordance with applicable law.
        </p>
        <p>
          For the current demo, booking and message history may remain stored while the system is
          being tested.
        </p>
      </LegalSection>

      <LegalSection heading="11. Your choices">
        <p>You may contact us to ask:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>what personal information we hold about you</li>
          <li>for incorrect information to be corrected</li>
          <li>for information to be deleted where appropriate</li>
          <li>to stop receiving promotional or rebooking messages</li>
        </ul>
        <p>
          Deleting customer information may affect features that rely on booking history, including
          rebooking reminders and visit-frequency calculations.
        </p>
        <p>
          Some information may need to be retained where required for legal, payment, accounting or
          dispute-resolution purposes.
        </p>
      </LegalSection>

      <LegalSection heading="12. Google Calendar">
        <p>
          If a barber connects a Google Calendar, Cut Deluxe may use calendar availability
          information to determine whether the barber is busy or available.
        </p>
        <p>The system should only access the information necessary for scheduling.</p>
        <p>Cut Deluxe does not need to use unrelated event content for customer bookings.</p>
      </LegalSection>

      <LegalSection heading="13. Privacy Act and Australian Privacy Principles">
        <p>
          The Privacy Act 1988 applies to organisations with annual turnover above $3 million and to
          some smaller organisations in particular circumstances.
        </p>
        <p>
          Regardless of whether Cut Deluxe is legally required to comply with every Australian
          Privacy Principle at its current size, this Privacy Policy is intended to provide clear
          information about how customer data is handled.
        </p>
        <p>
          If Cut Deluxe becomes an APP entity, its privacy practices and policy should comply with
          the Australian Privacy Principles, including requirements around transparency, access,
          correction, security and complaints.
        </p>
      </LegalSection>

      <LegalSection heading="14. Privacy complaints">
        <p>
          If you have a concern about how your personal information has been handled, contact Cut
          Deluxe using the contact details provided on our website.
        </p>
        <p>We will review the issue and aim to respond within a reasonable period.</p>
        <p>
          If the Privacy Act applies and you are not satisfied with the outcome, you may have the
          right to make a complaint to the Office of the Australian Information Commissioner.
        </p>
      </LegalSection>

      <LegalSection heading="15. Changes to this Privacy Policy">
        <p>We may update this Privacy Policy as Cut Deluxe changes.</p>
        <p>
          The current version will be published on our website and will show the date it was last
          updated.
        </p>
      </LegalSection>

      <LegalSection heading="16. Contact">
        <p>
          If you have questions about this Privacy Policy, your information, or a privacy concern,
          contact Cut Deluxe using the contact details available on our website.
        </p>
      </LegalSection>
    </LegalPage>
  );
}