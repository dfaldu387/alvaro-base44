import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { DEFAULT_GROUP_DISCOUNT_SETTINGS } from '../../shared/groupPricing.ts';
import { readSettingsList } from '../../shared/settingsStore.ts';
import { secrets } from 'base44:runtime';

// Public endpoint — no auth required.
// Serves all customer-facing homepage content: homepage presentation settings,
// active FAQs, public services (website-visible), public service areas (with
// map boundary + colour), and the public group-discount configuration.
// Operational/internal fields (capacity, max_bookings, private notes, user
// identifiers) are never exposed. Direct anonymous entity access is blocked by
// RLS; this function is the sanctioned public gateway and sanitises output.
const DEFAULT_HOMEPAGE_SETTINGS = {
  business_name: 'Cut Deluxe',
  tagline: 'Mobile Barbering',
  footer_text: "More than a haircut. It's a better way to get cut.",
  hero_enabled: true,
  hero_eyebrow: 'SYDNEY MOBILE BARBERING',
  hero_headline: 'Premium Cuts.',
  hero_highlight: 'At Your Door.',
  hero_description: "Professional barbering brought directly to you. Choose your service, tell us when you're available, and we'll organise the route.",
  hero_primary_cta_label: 'Book Now',
  hero_primary_cta_link: '/book',
  hero_secondary_cta_label: 'View Service Areas',
  hero_secondary_cta_link: '#areas',
  trust_enabled: true,
  trust_items: [
    { label: 'Mobile Service', description: 'We come to you', icon: 'car', enabled: true, sort_order: 1 },
    { label: 'No Waiting Room', description: 'Skip the queue', icon: 'clock', enabled: true, sort_order: 2 },
    { label: 'Group Bookings', description: 'Save together', icon: 'users', enabled: true, sort_order: 3 },
    { label: 'Sydney Coverage', description: 'Across Sydney', icon: 'map', enabled: true, sort_order: 4 },
  ],
  services_heading: 'Services & Pricing',
  services_show_addons: true,
  areas_enabled: true,
  areas_heading: 'Where We Come To You',
  areas_description: "We operate across Sydney on scheduled area days. Select your area to see when we're nearby.",
  areas_show_map: true,
  areas_show_cards: true,
  areas_show_days: true,
  areas_show_priority_explainer: true,
  areas_outside_heading: 'Outside our priority area?',
  areas_outside_text: "You can still request a booking. Clients inside our scheduled service region are prioritised when routes are finalised.",
  howitworks_enabled: true,
  howitworks_heading: 'How It Works',
  howitworks_steps: [
    { title: 'Choose your area', description: 'Tell us where you are.', icon: 'map', enabled: true, sort_order: 1 },
    { title: 'Choose your cut', description: 'Book for yourself or add multiple people.', icon: 'scissors', enabled: true, sort_order: 2 },
    { title: 'Give us your availability', description: "Tell us the full period you're free.", icon: 'clock', enabled: true, sort_order: 3 },
    { title: 'We confirm your time', description: 'We organise the route and send your confirmed appointment time.', icon: 'calendarcheck', enabled: true, sort_order: 4 },
  ],
  group_enabled: true,
  group_heading: 'Cutting the whole crew?',
  group_description: 'Book two or more people at the same address and save when group discounts are enabled.',
  afterhours_enabled: true,
  afterhours_heading: 'After-Hours Cuts',
  afterhours_description: "Need a cut outside our regular route? Submit an after-hours request and we'll let you know what's possible.",
  afterhours_starting_price: 100,
  afterhours_cta_label: 'Request After Hours',
  afterhours_cta_link: '/book',
  value_enabled: true,
  value_heading: 'Why Cut Deluxe',
  value_items: [
    { title: 'We come to you', description: 'No commute or waiting room.', icon: 'car', enabled: true, sort_order: 1 },
    { title: 'Built around your availability', description: "Give us your window and we'll organise the route.", icon: 'clock', enabled: true, sort_order: 2 },
    { title: 'Group friendly', description: 'Book multiple people at one address.', icon: 'users', enabled: true, sort_order: 3 },
    { title: 'Professional mobile setup', description: 'Full barbershop experience at your door.', icon: 'sparkles', enabled: true, sort_order: 4 },
  ],
  finalcta_heading: 'Ready for your next cut?',
  finalcta_description: "Tell us where you are and when you're free.",
  finalcta_primary_label: 'Book Now',
  finalcta_primary_link: '/book',
  finalcta_secondary_label: 'View Service Areas',
  finalcta_secondary_link: '#areas',
  faq_enabled: true,
  faq_heading: 'FAQ',
};

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const [hpRecords, faqs, services, addonRecords, serviceAreas, groupSettings, teamMembers] = await Promise.all([
      base44.asServiceRole.entities.HomepageSettings.list('-created_date', 10),
      base44.asServiceRole.entities.FAQ.list('sort_order', 100),
      base44.asServiceRole.entities.Service.list('sort_order', 100),
      base44.asServiceRole.entities.AddOn.list('sort_order', 100),
      base44.asServiceRole.entities.ServiceArea.list('sort_order', 200),
      readSettingsList(base44.asServiceRole, 'GroupDiscountSettings'),
      base44.asServiceRole.entities.TeamMember.list('-created_date', 200),
    ]);

    // Homepage settings: use the first record, merged over defaults so every
    // field is always present even on a partially-edited record.
    const homepageSettings = (hpRecords && hpRecords[0])
      ? { ...DEFAULT_HOMEPAGE_SETTINGS, ...hpRecords[0] }
      : DEFAULT_HOMEPAGE_SETTINGS;

    const activeFaqs = (faqs || [])
      .filter(f => f.active !== false)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map(f => ({ id: f.id, question: f.question, answer: f.answer }));

    const publicServices = (services || [])
      .filter(s => s.is_active !== false && s.show_on_website !== false)
      .map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        price: s.price,
        duration_mins: s.duration_mins,
        photo_url: s.photo_url,
        sort_order: s.sort_order,
        featured: !!s.featured,
      }));

    const publicAddons = (addonRecords || [])
      .filter(a => a.is_active !== false)
      .map(a => ({ id: a.id, name: a.name, price_adjustment: a.price_adjustment || 0 }));

    const memberNameById = {};
    for (const m of (teamMembers || [])) memberNameById[m.id] = m.name;
    const publicAreas = (serviceAreas || [])
      .filter(a => a.active !== false)
      .map(a => ({
        id: a.id,
        name: a.name,
        colour: a.colour || '#6f22cf',
        radius_km: a.radius_km ?? 10,
        centre_suburb: a.centre_suburb || '',
        latitude: a.latitude ?? null,
        longitude: a.longitude ?? null,
        suburbs: a.suburbs || [],
        team_member_name: a.team_member_name || memberNameById[a.team_member_id] || '',
        service_days: (a.service_days || []).filter(d => d.enabled).map(d => d.day_of_week),
        geometry: a.geometry ? (typeof a.geometry === 'string' ? JSON.parse(a.geometry) : a.geometry) : null,
      }));

    const gds = (groupSettings || []).find(s => !s.team_member_id)
      || (groupSettings || [])[0]
      || DEFAULT_GROUP_DISCOUNT_SETTINGS;
    const groupDiscountSettings = {
      enabled: gds.enabled !== false,
      tier_2_type: gds.tier_2_type,
      tier_2_amount: gds.tier_2_amount,
      tier_3_type: gds.tier_3_type,
      tier_3_amount: gds.tier_3_amount,
      tier_4plus_type: gds.tier_4plus_type,
      tier_4plus_amount: gds.tier_4plus_amount,
      core_radius_km: gds.core_radius_km ?? 15,
      extended_radius_km: gds.extended_radius_km ?? 25,
      maximum_service_radius_km: gds.maximum_service_radius_km ?? 35,
      service_centre_lat: gds.service_centre_lat ?? -33.87,
      service_centre_lng: gds.service_centre_lng ?? 151.21,
      service_centre_address: gds.service_centre_address || '',
    };

    // Browser maps need a Mapbox *public* token (pk.). A secret (sk./tk.) token is never sent to visitors.
    const rawMapboxToken = secrets.get('CUTDELUXEMAP') || secrets.get('MAPBOX_ACCESS_TOKEN') || null;
    const mapboxToken = typeof rawMapboxToken === 'string' && rawMapboxToken.startsWith('pk.') ? rawMapboxToken : null;
    return Response.json({ homepageSettings, faqs: activeFaqs, services: publicServices, addons: publicAddons, serviceAreas: publicAreas, groupDiscountSettings, mapboxToken });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}