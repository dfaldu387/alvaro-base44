import React from 'react';
import { Plus } from 'lucide-react';
import PersonCard from '@/components/appointments/PersonCard';
import { summarisePeople } from '@/lib/bookingPeople';

/**
 * The people on this booking — the structure that is actually saved.
 *
 * Each person has exactly one primary service and their own add-ons. Adding a
 * person is one tap; removing one takes their add-ons with them.
 */
export default function PeopleField({
  people, services, addonCatalogue, settings,
  onChangePerson, onRemovePerson, onAddPerson,
}) {
  const summary = summarisePeople(people, services, addonCatalogue, settings);

  return (
    <div className="space-y-2">
      {people.map((person, index) => (
        <PersonCard
          key={person.key}
          person={person}
          index={index}
          services={services}
          addonCatalogue={addonCatalogue}
          canRemove={people.length > 1}
          onChange={patch => onChangePerson(person.key, patch)}
          onRemove={() => onRemovePerson(person.key)}
        />
      ))}

      <button
        type="button"
        onClick={onAddPerson}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 px-3 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:border-violet-300 hover:bg-violet-50/50 hover:text-violet-700"
      >
        <Plus className="h-4 w-4" />
        Add another person
      </button>

      {summary.overMax && (
        <p className="text-xs font-medium text-amber-700">
          {summary.maxPeople} people is the maximum for one booking. Split this group into two bookings.
        </p>
      )}
    </div>
  );
}