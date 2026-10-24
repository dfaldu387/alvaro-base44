import React from 'react';
import LegalPage, { LegalSection } from '@/components/legal/LegalPage';

// Final Terms of Service. Every statement reflects how the app actually behaves.
export default function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="18 October 2026" draftNotice={false}>
      <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
        <p>
          These Terms of Service apply to bookings and services provided by Cut Deluxe Barbering
          through our website, messaging channels and other booking methods we make available.
        </p>
        <p>By submitting a booking request or using our services, you agree to these Terms.</p>
      </div>

      <LegalSection heading="1. About Cut Deluxe">
        <p>
          Cut Deluxe Barbering is a mobile barbering service operating in Sydney, New South Wales.
        </p>
        <p>
          We travel to customers and organise appointments around customer availability, location,
          travel time and the overall daily route.
        </p>
      </LegalSection>

      <LegalSection heading="2. Booking requests">
        <p>Submitting a booking request does not automatically create a confirmed appointment.</p>
        <p>When booking, you provide:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>your preferred date</li>
          <li>the period of time you are available</li>
          <li>your service location</li>
          <li>the services you want</li>
          <li>your contact details</li>
        </ul>
        <p>
          Cut Deluxe then schedules the request based on availability, travel requirements and the
          rest of the day&apos;s route.
        </p>
        <p>
          Your appointment is only confirmed once Cut Deluxe tells you that it has been confirmed.
        </p>
        <p>If we cannot accommodate your request, we will let you know.</p>
      </LegalSection>

      <LegalSection heading="3. Appointment times">
        <p>
          Because Cut Deluxe is a mobile service, appointment timing depends partly on travel
          between customers.
        </p>
        <p>
          You may provide an availability window rather than selecting an exact appointment time.
        </p>
        <p>
          Once the day&apos;s route has been organised, we will provide your scheduled arrival time.
        </p>
        <p>
          Traffic, road conditions, delays at earlier appointments or other circumstances outside
          our reasonable control may affect that time.
        </p>
        <p>If there is a material change, we will make reasonable efforts to notify you.</p>
      </LegalSection>

      <LegalSection heading="4. Prices">
        <p>
          The price shown when you submit your booking request is based on the services, location,
          number of customers and options selected at that time.
        </p>
        <p>
          Group discounts, additional travel charges, after-hours charges or other applicable
          charges will be shown or communicated before the relevant booking is confirmed.
        </p>
        <p>
          If you later change the booking in a way that changes the price, we will tell you before
          confirming the change.
        </p>
      </LegalSection>

      <LegalSection heading="5. Deposits and payments">
        <p>Some bookings may require a deposit before they are confirmed.</p>
        <p>
          Where a deposit is required, we will provide a payment link or another approved payment
          method.
        </p>
        <p>
          A booking requiring a deposit may remain unconfirmed until the deposit has been
          successfully paid.
        </p>
        <p>Payments may be processed through third-party payment providers such as Square.</p>
        <p>Cut Deluxe does not directly store your full payment-card details.</p>
      </LegalSection>

      <LegalSection heading="6. Changes and rescheduling">
        <p>If you need to change your appointment, contact us as early as possible.</p>
        <p>
          You can usually do this by replying to one of our booking messages or through another
          contact method we provide.
        </p>
        <p>A requested change is not complete until Cut Deluxe confirms the updated booking.</p>
        <p>Changes may affect:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>appointment time</li>
          <li>route availability</li>
          <li>price</li>
          <li>travel requirements</li>
          <li>service availability</li>
        </ul>
        <p>If we cannot accommodate the requested change, we will let you know.</p>
        <p>Same-day rescheduling may incur a fee of up to 25% of the booking value.</p>
      </LegalSection>

      <LegalSection heading="7. Cancellations and no-shows">
        <p>If you need to cancel, please provide as much notice as possible.</p>
        <p>
          If you do not attend or are unavailable when we arrive for a confirmed appointment, a
          no-show fee of up to 50% of the booking value may apply.
        </p>
        <p>An appointment may also be treated as missed where:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>nobody is available at the service location</li>
          <li>we cannot reasonably access the location</li>
          <li>there is no safe and legal place to park reasonably close to the address</li>
          <li>we are unable to contact you after arriving</li>
        </ul>
        <p>
          Any deposit, cancellation or no-show charge remains subject to your rights under
          Australian Consumer Law.
        </p>
      </LegalSection>

      <LegalSection heading="8. Service areas">
        <p>Cut Deluxe operates within defined service areas.</p>
        <p>
          Some locations may receive higher scheduling priority because they fit more efficiently
          into our normal operating areas and daily routes.
        </p>
        <p>Locations further outside our normal operating area may:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>require manual review</li>
          <li>have more limited availability</li>
          <li>attract an additional travel charge where disclosed</li>
          <li>be declined where we cannot reasonably service the location</li>
        </ul>
        <p>
          If your location is outside the areas we service entirely, the booking system may prevent
          the request from being submitted.
        </p>
      </LegalSection>

      <LegalSection heading="9. What we need from you">
        <p>
          Please make sure there is safe, legal parking reasonably close to the service address and
          that we can access the location safely.
        </p>
        <p>
          You must provide accurate information about the service location and anything that may
          reasonably affect our ability to provide the requested service safely.
        </p>
        <p>
          Where relevant, please tell us about scalp conditions, allergies, recent treatments or
          other circumstances that may affect the service.
        </p>
      </LegalSection>

      <LegalSection heading="10. Safety and refusal of service">
        <p>Cut Deluxe may refuse, stop or reschedule a service where we reasonably believe:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>the environment is unsafe</li>
          <li>lawful access or parking is unavailable</li>
          <li>continuing the service could create a health or safety risk</li>
          <li>a customer behaves abusively, threateningly or unlawfully</li>
          <li>the requested service cannot reasonably be provided safely</li>
        </ul>
        <p>Where appropriate, we will explain the reason.</p>
      </LegalSection>

      <LegalSection heading="11. Booking and service messages">
        <p>We may send messages necessary to manage your booking, including:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>booking-received messages</li>
          <li>confirmations</li>
          <li>reminders</li>
          <li>scheduled arrival times</li>
          <li>arrival updates</li>
          <li>changes</li>
          <li>cancellations</li>
          <li>payment information</li>
          <li>receipts</li>
        </ul>
        <p>Some of these messages may be generated or sent automatically.</p>
        <p>
          Routine messages may be sent without manual review. Messages requiring manual attention
          may be escalated to a person.
        </p>
      </LegalSection>

      <LegalSection heading="12. Rebooking and promotional messages">
        <p>Where permitted, Cut Deluxe may also send messages such as:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>reminders that you may be due for your next haircut</li>
          <li>rebooking reminders</li>
          <li>follow-ups</li>
          <li>relevant availability</li>
          <li>promotional messages</li>
        </ul>
        <p>
          You can opt out of promotional or rebooking messages at any time by replying STOP or using
          another unsubscribe method we provide.
        </p>
        <p>
          Opting out of promotional messages does not necessarily prevent us from sending messages
          reasonably required to manage an existing booking, payment or transaction.
        </p>
      </LegalSection>

      <LegalSection heading="13. Automated systems">
        <p>Cut Deluxe may use automated software to assist with:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>booking requests</li>
          <li>appointment scheduling</li>
          <li>routing</li>
          <li>appointment reminders</li>
          <li>customer communication</li>
          <li>payment status</li>
          <li>rebooking reminders</li>
          <li>administrative tasks</li>
        </ul>
        <p>
          Automated systems assist our operations but do not remove your ability to contact a person
          where an issue requires manual attention.
        </p>
      </LegalSection>

      <LegalSection heading="14. Customer information">
        <p>You must provide information that is accurate and reasonably complete.</p>
        <p>Cut Deluxe may rely on the information you provide when planning:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>your service</li>
          <li>appointment duration</li>
          <li>travel</li>
          <li>scheduling</li>
          <li>route timing</li>
          <li>pricing</li>
        </ul>
        <p>
          If incorrect or incomplete information materially affects the booking, we may need to
          change, delay or cancel the appointment.
        </p>
        <p>Personal information is handled in accordance with our Privacy Policy.</p>
      </LegalSection>

      <LegalSection heading="15. Mobile service and delays">
        <p>Cut Deluxe operates as a travelling service.</p>
        <p>Delays may occur because of circumstances such as:</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>traffic</li>
          <li>road closures</li>
          <li>accidents</li>
          <li>weather</li>
          <li>vehicle issues</li>
          <li>delays at earlier appointments</li>
          <li>emergencies</li>
        </ul>
        <p>
          Where this happens, we will make reasonable efforts to notify affected customers and
          minimise disruption.
        </p>
      </LegalSection>

      <LegalSection heading="16. Australian Consumer Law">
        <p>
          Nothing in these Terms excludes, restricts or modifies any right or guarantee that cannot
          lawfully be excluded under the Australian Consumer Law.
        </p>
        <p>
          Our services come with consumer guarantees that apply automatically where required by law.
        </p>
        <p>
          Depending on the circumstances, you may have rights to a repair, replacement service,
          refund, compensation or another remedy.
        </p>
      </LegalSection>

      <LegalSection heading="17. Third-party services">
        <p>
          Cut Deluxe may use third-party providers to operate parts of the service, including
          providers for:
        </p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li>payments</li>
          <li>SMS and messaging</li>
          <li>maps</li>
          <li>navigation</li>
          <li>routing</li>
          <li>location services</li>
          <li>hosting</li>
          <li>software infrastructure</li>
        </ul>
        <p>These providers may process information as reasonably necessary to provide their services.</p>
        <p>Further information is available in our Privacy Policy.</p>
      </LegalSection>

      <LegalSection heading="18. If something goes wrong">
        <p>
          If you have an issue with a booking or service, please contact us as soon as reasonably
          possible.
        </p>
        <p>
          We will try to understand the issue and work with you towards an appropriate resolution.
        </p>
        <p>
          Nothing in this section limits any rights or remedies available to you under Australian
          Consumer Law.
        </p>
      </LegalSection>

      <LegalSection heading="19. Changes to these Terms">
        <p>We may update these Terms from time to time as Cut Deluxe changes.</p>
        <p>
          The current version will be available through our website and will show the date it was
          last updated.
        </p>
        <p>Changes to these Terms do not remove rights that cannot legally be excluded.</p>
      </LegalSection>

      <LegalSection heading="20. Governing law">
        <p>These Terms are governed by the laws of New South Wales, Australia.</p>
      </LegalSection>

      <LegalSection heading="21. Contact">
        <p>
          If you have questions about these Terms or need help with a booking, contact Cut Deluxe
          using the contact details provided on our website or reply to one of our booking messages.
        </p>
      </LegalSection>
    </LegalPage>
  );
}