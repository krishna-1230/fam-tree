export type Gender = "male" | "female" | "other";
export type RelationshipType = "father" | "mother" | "spouse" | "sibling";
export type RelationshipSource = "explicit" | "inferred";
export type GraphMode = "2d" | "3d";

export interface Person {
	id: string;
	name: string;
	gender: Gender;
	date_of_birth?: string;
	metadata?: Record<string, unknown>;
}

export interface RawRelationshipRecord {
	id: string;
	from_person_id: string;
	to_person_id: string;
	type: RelationshipType;
	source?: RelationshipSource;
}

export interface RelationshipRecord {
	id: string;
	from_person_id: string;
	to_person_id: string;
	type: RelationshipType;
	relationship_source: RelationshipSource;
}

export interface GraphLink extends RelationshipRecord {
	source: string;
	target: string;
}

export interface GraphData {
	nodes: Person[];
	links: GraphLink[];
}

export interface GraphResponse {
	nodes: Person[];
	links: RawRelationshipRecord[];
}

export interface RelatedPerson extends Person {
	relationship_id: string;
	relationship_type: RelationshipType;
	relationship_source: RelationshipSource;
}

export interface PersonDetail extends Person {
	parents: RelatedPerson[];
	children: RelatedPerson[];
	spouses: RelatedPerson[];
	siblings: RelatedPerson[];
}

export interface CreatePersonInput {
	name: string;
	gender: Gender;
	date_of_birth?: string;
	metadata?: Record<string, unknown>;
}

export interface CreateRelationshipInput {
	from_person_id: string;
	to_person_id: string;
	type: RelationshipType;
}

export interface UpdatePersonInput {
	name?: string;
	gender?: Gender;
	date_of_birth?: string;
	metadata?: Record<string, unknown>;
}