import {
  Scissors, Calendar, CalendarCheck, MapPin, Clock, Users, Star, Phone, Mail,
  Instagram, Menu, X, ArrowRight, ArrowLeft, Check, CheckCircle, Sparkles, Moon,
  Car, Home as HomeIcon, Shield, Zap, Heart, Award, ThumbsUp, Navigation,
  ChevronDown, Plus, Minus, Search, Building2, Route, User, Hand, Timer,
  BadgeCheck, Send,
} from 'lucide-react';

const MAP = {
  scissors: Scissors, calendar: Calendar, calendarcheck: CalendarCheck,
  map: MapPin, mappin: MapPin, clock: Clock, users: Users, star: Star,
  phone: Phone, mail: Mail, instagram: Instagram, menu: Menu, x: X,
  arrowright: ArrowRight, arrowleft: ArrowLeft, check: Check, checkcircle: CheckCircle,
  sparkles: Sparkles, moon: Moon, car: Car, home: HomeIcon, shield: Shield,
  zap: Zap, heart: Heart, award: Award, thumbsup: ThumbsUp, navigation: Navigation,
  chevrondown: ChevronDown, plus: Plus, minus: Minus, search: Search,
  building: Building2, route: Route, user: User, hand: Hand, timer: Timer,
  badgecheck: BadgeCheck, send: Send,
};

export function getHomeIcon(name, Fallback = Sparkles) {
  if (!name) return Fallback;
  const key = String(name).toLowerCase().replace(/[\s_-]/g, '');
  return MAP[key] || Fallback;
}