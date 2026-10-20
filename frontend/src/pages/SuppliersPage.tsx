/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5)
 * Scope: Generated the supplier browse page against UI FR10 and D2 Part 2
 *        point 5, with no mockup to work from.
 * Reviewed by Ngooi Jun Sen.
 *
 * Covers UI FR10.1.1 (search and category filters), FR10.1.2 (approved only),
 * FR10.2.1 (desktop card grid, left filter sidebar), FR10.2.2 (mobile single
 * column, chip filter bar) and FR20.2.2 (explicit empty states). Paging and
 * category filtering happen on the service; sorting and name search happen in
 * the browser because the endpoint supports neither.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Checkbox } from '../components/ui/Checkbox';
import { Chip } from '../components/ui/Chip';
import { Icon } from '../components/ui/Icon';
import { fetchSuppliers, formatHours, isOpenAt, type Supplier } from '../lib/suppliers';
import styles from './SuppliersPage.module.css';

type Source = 'loading' | 'service' | 'failed';
type Sort = 'name' | 'nameDesc' | 'opensFirst';

const PAGE_SIZES = [20, 50, 100];

const SORTS: { value: Sort; label: string }[] = [
  { value: 'name', label: 'Name A to Z' },
  { value: 'nameDesc', label: 'Name Z to A' },
  { value: 'opensFirst', label: 'Opens earliest' },
];

export function SuppliersPage() {
  const [supplierPage, setSupplierPage] = useState<Supplier[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [source, setSource] = useState<Source>('loading');
  // Bumped by the retry button to re-run the fetch.
  const [reloadKey, setReloadKey] = useState(0);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>('name');
  const [query, setQuery] = useState('');
  const [openOnly, setOpenOnly] = useState(false);

  /*
   * TODO(supplier-service): the category list should be its own endpoint.
   * Fetched once unfiltered so the chips stay stable while paging; without
   * that, the options would change under the user as they moved through
   * pages.
   */
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchSuppliers({ pageSize: 100 })
      .then((result) => {
        if (cancelled) return;
        setCategories(
          [...new Set(result.items.flatMap((s) => s.categories.map((c) => c.name)))].sort(),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * The endpoint has no search parameter, so a name search has to happen in
   * the browser. Searching only the current page would silently miss matches
   * on later pages, so while a search is active the whole catalogue is
   * fetched instead and the pager steps aside. 100 is the service's maximum
   * page (Supplier NFR1.1.1); beyond that this stops being honest and the
   * endpoint needs a search parameter.
   */
  const searching = query.trim().length > 0;

  // Paging and category filtering are real service calls (Supplier F1.2,
  // NFR1.1). Changing either refetches.
  useEffect(() => {
    let cancelled = false;

    fetchSuppliers(
      searching
        ? { page: 1, pageSize: 100, categories: selectedCategories }
        : { page, pageSize, categories: selectedCategories },
    )
      .then((result) => {
        if (cancelled) return;
        setSupplierPage(result.items);
        setHasMore(!searching && result.hasMore);
        setSource('service');
      })
      .catch(() => {
        if (cancelled) return;
        setSupplierPage([]);
        setHasMore(false);
        setSource('failed');
      });

    return () => {
      cancelled = true;
    };
  }, [page, pageSize, selectedCategories, searching, reloadKey]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return supplierPage
      .filter((supplier) => {
        if (needle.length > 0) {
          const haystack = [supplier.name, supplier.building, supplier.locationDescription]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        if (openOnly && isOpenAt(supplier) !== true) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === 'nameDesc') return b.name.localeCompare(a.name);
        if (sort === 'opensFirst') return a.startingTime.localeCompare(b.startingTime);
        return a.name.localeCompare(b.name);
      });
  }, [supplierPage, query, openOnly, sort]);

  function toggleCategory(name: string) {
    setPage(1); // a filter change invalidates the page number
    setSelectedCategories((current) =>
      current.includes(name) ? current.filter((value) => value !== name) : [...current, name],
    );
  }

  const narrowed = searching || openOnly;

  const filters = (
    <>
      <section className={styles.group}>
        <h2 className={styles.groupTitle}>Category</h2>
        <div className={styles.checkList}>
          {categories.map((name) => (
            <Checkbox
              key={name}
              label={name}
              checked={selectedCategories.includes(name)}
              onChange={() => toggleCategory(name)}
            />
          ))}
        </div>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>Availability</h2>
        <Checkbox label="Open now" checked={openOnly} onChange={setOpenOnly} />
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>Sort</h2>
        <select
          className={styles.select}
          value={sort}
          aria-label="Sort suppliers"
          onChange={(event) => setSort(event.target.value as Sort)}
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </section>

      <section className={styles.group}>
        <h2 className={styles.groupTitle}>Per page</h2>
        <select
          className={styles.select}
          value={pageSize}
          aria-label="Results per page"
          onChange={(event) => {
            setPage(1);
            setPageSize(Number(event.target.value));
          }}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </section>
    </>
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          Suppliers
          <span className={styles.subtitle}>
            {source === 'loading'
              ? 'Loading'
              : source === 'failed'
                ? 'Unavailable'
                : searching
                ? `${visible.length} matching, whole catalogue`
                : narrowed
                  ? `${visible.length} of ${supplierPage.length} on this page`
                  : `${supplierPage.length} on this page`}
          </span>
        </h1>

        <div className={styles.headerTools}>
          <label className={styles.search}>
            <Icon name="search" size={16} />
            <span className="visually-hidden">Search suppliers</span>
            <input
              type="search"
              placeholder="Search by name or building"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <Link to="/suppliers/new" className={styles.suggest}>
            Suggest a supplier
          </Link>
        </div>
      </header>

      {source === 'failed' ? (
        <div className={styles.failure} role="alert">
          <p className={styles.failureTitle}>Cannot reach the Supplier Service</p>
          <p className={styles.failureBody}>
            The catalogue could not be loaded. Check the service is running, then try again.
          </p>
          <button
            type="button"
            className={styles.retry}
            onClick={() => {
              setSource('loading');
              setReloadKey((key) => key + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : null}

      <div className={styles.chipBar}>
        <Chip selected={openOnly} onClick={() => setOpenOnly((value) => !value)}>
          Open now
        </Chip>
        {categories.map((name) => (
          <Chip
            key={name}
            selected={selectedCategories.includes(name)}
            onClick={() => toggleCategory(name)}
          >
            {name}
          </Chip>
        ))}
      </div>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          {filters}

          {/*
            Scaffolding for review, not shipping copy: UI FR10.1.1 asks for
            Store, Facility and Landmark toggles, which is Supplier F1.1's
            Type field. No service implements it, so these are F1.2.1 tags.
          */}
          <p className={styles.sidebarNote}>
            Filtering by category. FR10.1.1 asks for Store, Facility and Landmark, which is the
            Type field no service implements yet. Sorting runs in the browser, and a name search
            loads the whole catalogue, because the endpoint supports neither.
          </p>
        </aside>

        <section className={styles.results}>
          {source === 'loading' ? (
            <p className={styles.empty}>Loading suppliers…</p>
          ) : source === 'failed' ? null : visible.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>No suppliers match</p>
              <p className={styles.emptyBody}>
                {narrowed || selectedCategories.length > 0
                  ? 'Try clearing a filter, or look on another page.'
                  : 'The catalogue is empty. Suppliers appear here once an admin approves them.'}
              </p>
            </div>
          ) : (
            <div className={styles.grid}>
              {visible.map((supplier) => {
                const open = isOpenAt(supplier);

                return (
                  <Link
                    key={supplier.id}
                    to={`/suppliers/${supplier.id}`}
                    className={styles.card}
                  >
                    <div className={styles.cardHead}>
                      <h3 className={styles.name}>{supplier.name}</h3>
                      {open === null ? null : (
                        <span className={open ? styles.open : styles.closed}>
                          {open ? 'Open' : 'Closed'}
                        </span>
                      )}
                    </div>

                    <p className={styles.where}>
                      {[supplier.building, supplier.floor ? `Level ${supplier.floor}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>

                    {supplier.locationDescription ? (
                      <p className={styles.detail}>{supplier.locationDescription}</p>
                    ) : null}

                    <p className={styles.hours}>{formatHours(supplier)}</p>

                    <ul className={styles.tags}>
                      {supplier.categories.map((category) => (
                        <li key={category.id} className={styles.tag}>
                          {category.name}
                        </li>
                      ))}
                    </ul>
                  </Link>
                );
              })}
            </div>
          )}

          {/*
            Supplier NFR1.1. There is no total in the response, so this cannot
            say "page 2 of 5"; a full page is taken to mean another follows.
          */}
          {searching ? null : (
          <nav className={styles.pager} aria-label="Pagination">
            <button
              type="button"
              className={styles.pageButton}
              disabled={page === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </button>
            <span className={styles.pageLabel}>Page {page}</span>
            <button
              type="button"
              className={styles.pageButton}
              disabled={!hasMore}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </button>
          </nav>
          )}
        </section>
      </div>
    </div>
  );
}
