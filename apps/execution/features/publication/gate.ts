/** Omitted preserves existing isolated-domain configurations; explicit false closes publication. */
export interface PublicationConfiguration { PUBLICATION_ENABLED?: string }

export function publicationEnabled(environment: PublicationConfiguration): boolean {
  return environment.PUBLICATION_ENABLED === undefined || environment.PUBLICATION_ENABLED === 'true';
}

export function requirePublication(environment: PublicationConfiguration): void {
  if (!publicationEnabled(environment)) throw new Error('Entity publication disabled');
}
