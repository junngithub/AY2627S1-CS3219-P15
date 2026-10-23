/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-23
 * Scope: Generated the admin's edit-supplier dialog, reusing the fields and
 *        checks of the suggest-a-supplier form.
 * Reviewed by Ngooi Jun Sen.
 *
 * PATCH /api/v1/supplier/{id} (admin only) changes only the fields it is
 * sent, so the dialog sends only what was changed. Status is left to the
 * Approve and Reject buttons.
 */

import { useState, type FormEvent } from 'react';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { TextAreaField } from '../ui/Inputs';
import { TextField } from '../ui/TextField';
import { errorMessage } from '../../lib/api';
import { updateSupplier, type NewSupplier, type Supplier } from '../../lib/suppliers';
import styles from './EditSupplierDialog.module.css';

interface EditSupplierDialogProps {
  /** The supplier being edited; null keeps the dialog closed. */
  supplier: Supplier | null;
  /** Every category already in use, offered as chips. */
  knownCategories: string[];
  onClose: () => void;
  onSaved: (supplier: Supplier) => void;
}

export function EditSupplierDialog({ supplier, knownCategories, onClose, onSaved }: EditSupplierDialogProps) {
  // Keyed on the supplier, so opening another row starts from its values.
  return supplier === null ? null : (
    <EditSupplierForm
      key={supplier.id}
      supplier={supplier}
      knownCategories={knownCategories}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

function EditSupplierForm({
  supplier,
  knownCategories,
  onClose,
  onSaved,
}: EditSupplierDialogProps & { supplier: Supplier }) {
  const original = {
    name: supplier.name,
    building: supplier.building ?? '',
    floor: supplier.floor ?? '',
    description: supplier.locationDescription ?? '',
    latitude: String(supplier.latitude),
    longitude: String(supplier.longitude),
    opens: supplier.startingTime,
    closes: supplier.closingTime,
    categories: supplier.categories.map((category) => category.name),
  };

  const [name, setName] = useState(original.name);
  const [building, setBuilding] = useState(original.building);
  const [floor, setFloor] = useState(original.floor);
  const [description, setDescription] = useState(original.description);
  const [latitude, setLatitude] = useState(original.latitude);
  const [longitude, setLongitude] = useState(original.longitude);
  const [opens, setOpens] = useState(original.opens);
  const [closes, setCloses] = useState(original.closes);
  const [categories, setCategories] = useState<string[]>(original.categories);
  const [known, setKnown] = useState<string[]>(() =>
    [...new Set([...knownCategories, ...original.categories])].sort(),
  );
  const [newCategory, setNewCategory] = useState('');

  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const lat = Number.parseFloat(latitude);
  const lng = Number.parseFloat(longitude);
  const timesChanged = opens !== original.opens || closes !== original.closes;

  const errors = {
    name: name.trim() === '' ? 'Give the supplier a name' : null,
    // Supplier F1.1.1: well-formed coordinates.
    latitude: Number.isNaN(lat) || lat < -90 || lat > 90 ? 'Must be between -90 and 90' : null,
    longitude: Number.isNaN(lng) || lng < -180 || lng > 180 ? 'Must be between -180 and 180' : null,
    // Supplier F1.1.2: opening before closing. Checked only when the hours are
    // edited, so a listing that already crosses midnight (one seeded row does)
    // can still have its other fields changed.
    closes:
      timesChanged && opens !== '' && closes !== '' && closes <= opens
        ? 'Must be after the opening time'
        : null,
    categories: categories.length === 0 ? 'Pick at least one category' : null,
  };

  // Only what differs from the stored listing is sent.
  const changes: Partial<NewSupplier> = {};
  if (name.trim() !== original.name) changes.name = name.trim();
  if (building.trim() !== original.building) changes.building = building.trim();
  if (floor.trim() !== original.floor) changes.floor = floor.trim();
  if (description.trim() !== original.description) changes.locationDescription = description.trim();
  if (latitude.trim() !== original.latitude) changes.latitude = lat;
  if (longitude.trim() !== original.longitude) changes.longitude = lng;
  if (opens !== original.opens) changes.startingTime = opens;
  if (closes !== original.closes) changes.closingTime = closes;
  if (!sameSet(categories, original.categories)) changes.categories = categories;

  const hasChanges = Object.keys(changes).length > 0;
  const isValid = Object.values(errors).every((error) => error === null);

  function toggleCategory(value: string) {
    setCategories((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  function addCategory() {
    const value = newCategory.trim();
    if (value === '') return;
    setKnown((current) => (current.includes(value) ? current : [...current, value].sort()));
    setCategories((current) => (current.includes(value) ? current : [...current, value]));
    setNewCategory('');
  }

  async function save(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!isValid || !hasChanges || saving) return;

    setSaving(true);
    setFailure(null);
    try {
      onSaved(await updateSupplier(supplier.id, changes));
    } catch (error) {
      // The service's own reason (e.g. invalid coordinates) is shown as given.
      setFailure(errorMessage(error, 'Could not reach the Supplier Service, so nothing was changed.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title={`Edit ${supplier.name}`}
      onClose={saving ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button disabled={!isValid || !hasChanges} loading={saving} onClick={() => void save()}>
            Save changes
          </Button>
        </>
      }
    >
      <form className={styles.form} onSubmit={(event) => void save(event)} noValidate>
        {failure ? <Alert variant="danger">{failure}</Alert> : null}

        <TextField
          label="Name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name}
        />

        <div className={styles.row}>
          <TextField
            label="Building"
            name="building"
            value={building}
            onChange={(event) => setBuilding(event.target.value)}
          />
          <TextField
            label="Floor"
            name="floor"
            value={floor}
            onChange={(event) => setFloor(event.target.value)}
          />
        </div>

        <TextAreaField
          label="Where exactly"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <Field label="Categories" error={errors.categories}>
          <div className={styles.chips}>
            {known.map((value) => (
              <Chip key={value} selected={categories.includes(value)} onClick={() => toggleCategory(value)}>
                {value}
              </Chip>
            ))}
          </div>
        </Field>

        <div className={styles.addCategory}>
          <TextField
            label="Add a category"
            name="newCategory"
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addCategory();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={addCategory}>
            Add
          </Button>
        </div>

        <div className={styles.row}>
          <TextField
            label="Opens"
            name="opens"
            type="time"
            value={opens}
            onChange={(event) => setOpens(event.target.value)}
          />
          <TextField
            label="Closes"
            name="closes"
            type="time"
            value={closes}
            onChange={(event) => setCloses(event.target.value)}
            error={errors.closes}
          />
        </div>

        <div className={styles.row}>
          <TextField
            label="Latitude"
            name="latitude"
            inputMode="decimal"
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
            error={errors.latitude}
          />
          <TextField
            label="Longitude"
            name="longitude"
            inputMode="decimal"
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
            error={errors.longitude}
          />
        </div>

        {/* Enter in a field submits, as in any form; the visible button is in the footer. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
