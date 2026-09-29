/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the suggest-a-supplier form against UI FR11, with no
 *        mockup to work from.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR11.1.1 (name, type and location fields), FR11.1.2 (the pending
 * review notice) and FR11.2.1 (one centred layout on both viewports). The
 * validation follows Supplier F1.1.1 for coordinates and F1.1.2 for times;
 * the service only enforces the first, so the second is checked here and
 * still needs fixing server side.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Chip } from '../components/ui/Chip';
import { Field } from '../components/ui/Field';
import { TextField } from '../components/ui/TextField';
import { TextAreaField } from '../components/ui/Inputs';
import { ApiError } from '../lib/api';
import { createSupplier, fetchSuppliers } from '../lib/suppliers';
import styles from './NewSupplierPage.module.css';

export function NewSupplierPage() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [building, setBuilding] = useState('');
  const [floor, setFloor] = useState('');
  const [description, setDescription] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [opens, setOpens] = useState('09:00');
  const [closes, setCloses] = useState('18:00');

  const [known, setKnown] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState('');

  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Offer the categories already in use, so the free-text field is a last
  // resort rather than the only option (see the typo risk in open-items).
  useEffect(() => {
    let cancelled = false;
    fetchSuppliers({ pageSize: 100 })
      .then((result) => {
        if (cancelled) return;
        setKnown([...new Set(result.items.flatMap((s) => s.categories.map((c) => c.name)))].sort());
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const lat = Number.parseFloat(latitude);
  const lng = Number.parseFloat(longitude);

  const errors = {
    name: name.trim() === '' ? 'Give the supplier a name' : null,
    // Supplier F1.1.1: well-formed coordinates before the listing is stored.
    latitude:
      latitude.trim() === ''
        ? 'Needed so couriers can be ranked by distance'
        : Number.isNaN(lat) || lat < -90 || lat > 90
          ? 'Must be between -90 and 90'
          : null,
    longitude:
      longitude.trim() === ''
        ? 'Needed so couriers can be ranked by distance'
        : Number.isNaN(lng) || lng < -180 || lng > 180
          ? 'Must be between -180 and 180'
          : null,
    // Supplier F1.1.2: opening strictly before closing.
    closes: opens !== '' && closes !== '' && closes <= opens ? 'Must be after the opening time' : null,
    categories: categories.length === 0 ? 'Pick at least one category' : null,
  };

  const isValid = Object.values(errors).every((error) => error === null);

  function toggleCategory(value: string) {
    setCategories((current) =>
      current.includes(value) ? current.filter((name) => name !== value) : [...current, value],
    );
  }

  function addCategory() {
    const value = newCategory.trim();
    if (value === '') return;
    setKnown((current) => (current.includes(value) ? current : [...current, value].sort()));
    setCategories((current) => (current.includes(value) ? current : [...current, value]));
    setNewCategory('');
  }

  function useMyLocation() {
    if (!('geolocation' in navigator)) {
      setFailure('This browser cannot report your location. Enter the coordinates by hand.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setFailure('Could not read your location. Enter the coordinates by hand.');
        setLocating(false);
      },
      { timeout: 10_000 },
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValid || submitting) return;

    setSubmitting(true);
    setFailure(null);
    try {
      await createSupplier({
        name: name.trim(),
        building: building.trim(),
        floor: floor.trim(),
        locationDescription: description.trim(),
        latitude: lat,
        longitude: lng,
        startingTime: opens,
        closingTime: closes,
        categories,
      });
      setSubmitted(true);
    } catch (error) {
      // Supplier NFR2.1.1 rejects an invalid submission with a specific error,
      // so show that rather than swallowing it.
      setFailure(
        error instanceof ApiError
          ? error.message
          : 'Could not reach the Supplier Service. Check that it is running and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  // UI FR11.1.2: say plainly that the listing is waiting on an admin.
  if (submitted) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>Thanks &mdash; it&apos;s with an admin</h1>
          <p className={styles.lede}>
            {name.trim()} has been submitted and is pending review. It will not appear in the
            catalogue, or be selectable as a pickup or delivery point, until an admin approves it.
          </p>
          <div className={styles.actions}>
            <Button onClick={() => navigate('/suppliers')}>Back to suppliers</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSubmitted(false);
                setName('');
                setBuilding('');
                setFloor('');
                setDescription('');
                setCategories([]);
              }}
            >
              Suggest another
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.page} onSubmit={handleSubmit} noValidate>
      <div className={styles.card}>
        <header className={styles.header}>
          <h1 className={styles.title}>Suggest a supplier</h1>
          <p className={styles.lede}>
            Somewhere on campus people run errands to. An admin reviews it before it appears.{' '}
            <Link to="/suppliers">See what is already listed</Link>.
          </p>
        </header>

        <TextField
          label="Name"
          name="name"
          placeholder="Cool Spot"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={name.trim() === '' && submitting ? errors.name : null}
        />

        <div className={styles.row}>
          <TextField
            label="Building"
            name="building"
            placeholder="COM2"
            value={building}
            onChange={(event) => setBuilding(event.target.value)}
          />
          <TextField
            label="Floor"
            name="floor"
            placeholder="1"
            value={floor}
            onChange={(event) => setFloor(event.target.value)}
          />
        </div>

        <TextAreaField
          label="Where exactly"
          placeholder="Opposite LT16, next to the vending machines"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          hint="How someone finds it once they are in the building."
        />

        <Field
          label="Categories"
          error={categories.length > 0 ? null : errors.categories}
          hint="What it sells or provides. Pick all that apply."
        >
          <div className={styles.chips}>
            {known.map((value) => (
              <Chip
                key={value}
                selected={categories.includes(value)}
                onClick={() => toggleCategory(value)}
              >
                {value}
              </Chip>
            ))}
          </div>
        </Field>

        <div className={styles.addCategory}>
          <TextField
            label="Add a category"
            name="newCategory"
            placeholder="Stationery"
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addCategory();
              }
            }}
            hint="Only if none of the above fit. New categories are created as typed."
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

        <Field
          label="Coordinates"
          hint="Used to rank errands by how close the pickup point is to a courier."
        >
          <div className={styles.coords}>
            <TextField
              label="Latitude"
              name="latitude"
              inputMode="decimal"
              placeholder="1.2940"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              error={latitude === '' ? null : errors.latitude}
            />
            <TextField
              label="Longitude"
              name="longitude"
              inputMode="decimal"
              placeholder="103.7738"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              error={longitude === '' ? null : errors.longitude}
            />
          </div>
        </Field>

        {/*
          Nobody is going to type coordinates. This is the pragmatic answer
          until a map picker exists; see the note in docs/open-items.md.
        */}
        <Button type="button" variant="secondary" onClick={useMyLocation} loading={locating}>
          Use my current location
        </Button>

        {failure ? <Alert variant="danger">{failure}</Alert> : null}

        <div className={styles.submit}>
          <Button type="submit" fullWidth disabled={!isValid} loading={submitting}>
            Submit for review
          </Button>
        </div>
      </div>
    </form>
  );
}
